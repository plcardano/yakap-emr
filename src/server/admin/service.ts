import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { audit } from "@/server/audit/log";
import { hashPassword } from "@/server/auth/password";
import { encryptAtRest } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { facilities, sessions, users } from "@/server/db/schema";
import { fieldFailure } from "@/server/verification/failure";

export type AdminActor = { id: string; facilityId: string; role: "admin" | "staff" };

const MIN_PASSWORD = 12;
const passwordMessage = `Use at least ${MIN_PASSWORD} characters.`;

function assertAdmin(actor: AdminActor) {
  if (actor.role !== "admin") throw new Error("Administrator access is required");
}

function log(actor: AdminActor, action: string, details: Record<string, unknown> = {}) {
  return audit({ action, facilityId: actor.facilityId, userId: actor.id, details });
}

export type StaffRow = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "staff";
  active: boolean;
};

export async function listStaff(actor: AdminActor): Promise<StaffRow[]> {
  assertAdmin(actor);
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      active: users.active,
    })
    .from(users)
    .where(eq(users.facilityId, actor.facilityId))
    .orderBy(asc(users.username));
}

export async function facilityStatus(actor: AdminActor) {
  assertAdmin(actor);
  const [facility] = await db
    .select({ name: facilities.name, cipher: facilities.cipherKeyEncrypted })
    .from(facilities)
    .where(eq(facilities.id, actor.facilityId));
  return { name: facility.name, hasCipherKey: Boolean(facility.cipher) };
}

const newStaff = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Enter a user name.")
    .refine((value) => new TextEncoder().encode(value).length <= 150, "This is too long."),
  displayName: z.string().trim().min(1, "Enter the person's name.").max(200, "This is too long."),
  password: z.string().min(MIN_PASSWORD, passwordMessage),
  role: z.enum(["admin", "staff"]),
});

export type NewStaffInput = z.input<typeof newStaff>;

export async function createStaff(
  actor: AdminActor,
  input: NewStaffInput,
): Promise<ActionResult<{ id: string }>> {
  assertAdmin(actor);
  const parsed = newStaff.safeParse(input);
  if (!parsed.success) {
    const errors = z.flattenError(parsed.error).fieldErrors;
    return fieldFailure(
      Object.fromEntries(
        Object.entries(errors).map(([field, messages]) => [field, messages?.[0] ?? ""]),
      ),
    );
  }
  const { password, ...details } = parsed.data;

  const [created] = await db
    .insert(users)
    .values({
      ...details,
      facilityId: actor.facilityId,
      passwordHash: await hashPassword(password),
    })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (!created) return fieldFailure({ username: "This user name is already used." });

  await log(actor, "admin.staff_created", { staffId: created.id, role: details.role });
  return { ok: true, data: created };
}

function ownStaff(actor: AdminActor, id: string) {
  return and(eq(users.id, id), eq(users.facilityId, actor.facilityId));
}

export async function setStaffActive(
  actor: AdminActor,
  id: string,
  active: boolean,
): Promise<ActionResult<null>> {
  assertAdmin(actor);
  if (id === actor.id) return { ok: false, title: "You cannot deactivate your own account" };

  const updated = await db
    .update(users)
    .set({ active, failedLoginCount: 0, lockedUntil: null })
    .where(ownStaff(actor, id))
    .returning({ id: users.id });
  if (!updated.length) return { ok: false, title: "This account was not found" };

  if (!active) await db.delete(sessions).where(eq(sessions.userId, id));
  await log(actor, active ? "admin.staff_activated" : "admin.staff_deactivated", { staffId: id });
  return { ok: true, data: null };
}

export async function resetStaffPassword(
  actor: AdminActor,
  id: string,
  password: string,
): Promise<ActionResult<null>> {
  assertAdmin(actor);
  if (password.length < MIN_PASSWORD) return fieldFailure({ password: passwordMessage });

  const updated = await db
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(ownStaff(actor, id))
    .returning({ id: users.id });
  if (!updated.length) return { ok: false, title: "This account was not found" };

  await db.delete(sessions).where(eq(sessions.userId, id));
  await log(actor, "admin.password_reset", { staffId: id });
  return { ok: true, data: null };
}

/** The key can be replaced but is never shown again. */
export async function setCipherKey(actor: AdminActor, key: string): Promise<ActionResult<null>> {
  assertAdmin(actor);
  const trimmed = key.trim();
  if (!trimmed) return fieldFailure({ cipherKey: "Enter the cipher key." });

  await db
    .update(facilities)
    .set({ cipherKeyEncrypted: encryptAtRest(trimmed) })
    .where(eq(facilities.id, actor.facilityId));
  await log(actor, "admin.cipher_key_set");
  return { ok: true, data: null };
}
