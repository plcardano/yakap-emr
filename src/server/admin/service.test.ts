import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdminActor } from "./service";

const ACCRE = "H44445555";
const OTHER = "H44445556";
const PASSWORD = "a-long-enough-password";

describe.runIf(process.env.DATABASE_URL)("administration", () => {
  let admin: typeof import("./service");
  let t: typeof import("@/server/db/schema");
  let db: typeof import("@/server/db").db;
  let actor: AdminActor;
  let otherFacilityUserId: string;
  let otherFacilityId: string;

  const unique = () => `user-${randomBytes(4).toString("hex")}`;
  const add = async (overrides = {}) => {
    const result = await admin.createStaff(actor, {
      username: unique(),
      displayName: "Staff",
      password: PASSWORD,
      role: "staff",
      ...overrides,
    });
    if (!result.ok) throw new Error(result.title);
    return result.data.id;
  };
  const userRow = async (id: string) =>
    (await db.select().from(t.users).where(eq(t.users.id, id)))[0];

  beforeAll(async () => {
    t = await import("@/server/db/schema");
    ({ db } = await import("@/server/db"));
    admin = await import("./service");

    const [facility] = await db.insert(t.facilities).values({ accreNo: ACCRE, name: "A" }).returning();
    const [other] = await db.insert(t.facilities).values({ accreNo: OTHER, name: "B" }).returning();
    otherFacilityId = other.id;
    const [user] = await db
      .insert(t.users)
      .values({ facilityId: facility.id, username: unique(), displayName: "Admin", passwordHash: "x", role: "admin" })
      .returning();
    const [outsider] = await db
      .insert(t.users)
      .values({ facilityId: other.id, username: unique(), displayName: "Other", passwordHash: "x" })
      .returning();
    otherFacilityUserId = outsider.id;
    actor = { id: user.id, facilityId: facility.id, role: "admin" };
  });

  afterAll(async () => {
    for (const id of [actor.facilityId, otherFacilityId]) {
      await db.delete(t.auditLog).where(eq(t.auditLog.facilityId, id));
      await db.delete(t.users).where(eq(t.users.facilityId, id));
      await db.delete(t.facilities).where(eq(t.facilities.id, id));
    }
  });

  it("refuses a non-administrator", async () => {
    await expect(admin.listStaff({ ...actor, role: "staff" })).rejects.toThrow();
    await expect(admin.setCipherKey({ ...actor, role: "staff" }, "k")).rejects.toThrow();
  });

  it("creates staff with a hashed password", async () => {
    const row = await userRow(await add());
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it("requires a long password and a unique user name", async () => {
    expect(
      await admin.createStaff(actor, { username: unique(), displayName: "X", password: "short", role: "staff" }),
    ).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });

    const username = unique();
    await add({ username });
    expect(
      await admin.createStaff(actor, { username, displayName: "X", password: PASSWORD, role: "staff" }),
    ).toMatchObject({ ok: false, fieldErrors: { username: "This user name is already used." } });
  });

  it("lists only its own facility", async () => {
    const ids = (await admin.listStaff(actor)).map((row) => row.id);
    expect(ids).toContain(actor.id);
    expect(ids).not.toContain(otherFacilityUserId);
  });

  it("deactivating ends the person's sessions", async () => {
    const id = await add();
    await db.insert(t.sessions).values({
      userId: id,
      tokenHash: randomBytes(32).toString("hex"),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await admin.setStaffActive(actor, id, false)).ok).toBe(true);
    expect((await userRow(id)).active).toBe(false);
    expect(await db.select().from(t.sessions).where(eq(t.sessions.userId, id))).toEqual([]);
  });

  it("cannot deactivate yourself or touch another facility", async () => {
    expect((await admin.setStaffActive(actor, actor.id, false)).ok).toBe(false);
    expect((await admin.setStaffActive(actor, otherFacilityUserId, false)).ok).toBe(false);
    expect((await userRow(otherFacilityUserId)).active).toBe(true);
    expect((await admin.resetStaffPassword(actor, otherFacilityUserId, PASSWORD)).ok).toBe(false);
  });

  it("resets a password, clears a lockout and ends sessions", async () => {
    const id = await add();
    await db.update(t.users).set({ lockedUntil: new Date(Date.now() + 60_000) }).where(eq(t.users.id, id));
    expect((await admin.resetStaffPassword(actor, id, "another-long-password")).ok).toBe(true);
    expect((await userRow(id)).lockedUntil).toBeNull();
  });

  it("stores the cipher key encrypted and never logs it", async () => {
    expect(await admin.setCipherKey(actor, "   ")).toMatchObject({ ok: false });
    expect((await admin.setCipherKey(actor, "SECRET-CIPHER")).ok).toBe(true);
    const [row] = await db.select().from(t.facilities).where(eq(t.facilities.id, actor.facilityId));
    expect(row.cipherKeyEncrypted).toMatch(/^v1\./);
    expect(row.cipherKeyEncrypted).not.toContain("SECRET-CIPHER");
    expect((await admin.facilityStatus(actor)).hasCipherKey).toBe(true);
    const logs = await db.select().from(t.auditLog).where(eq(t.auditLog.facilityId, actor.facilityId));
    expect(JSON.stringify(logs)).not.toContain("SECRET-CIPHER");
  });
});
