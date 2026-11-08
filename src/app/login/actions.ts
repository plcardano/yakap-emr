"use server";

import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@/server/audit/log";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { facilities, users } from "@/server/db/schema";

export type LoginState = {
  error?: string;
  fieldErrors?: { accreNo?: string; username?: string; password?: string };
  /** Restored after a failed attempt. The password is never returned. */
  values?: { accreNo: string; username: string };
};

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const INCORRECT = "The accreditation number, user name or password is incorrect.";

const credentials = z.object({
  accreNo: z.string().trim().length(9, "Enter the 9-character accreditation number."),
  username: z.string().trim().min(1, "Enter your user name."),
  password: z.string().min(1, "Enter your password."),
});

// Keeps response time similar when the account does not exist.
const dummyHash = hashPassword("not-a-real-password");

export async function login(
  _previous: LoginState,
  form: FormData,
): Promise<LoginState> {
  const values = {
    accreNo: String(form.get("accreNo") ?? ""),
    username: String(form.get("username") ?? ""),
  };
  const failed: LoginState = { error: INCORRECT, values };

  const parsed = credentials.safeParse({
    accreNo: form.get("accreNo"),
    username: form.get("username"),
    password: form.get("password"),
  });
  if (!parsed.success) {
    const { accreNo, username, password } = z.flattenError(parsed.error).fieldErrors;
    return {
      values,
      fieldErrors: {
        accreNo: accreNo?.[0],
        username: username?.[0],
        password: password?.[0],
      },
    };
  }

  const { accreNo, username, password } = parsed.data;
  const [account] = await db
    .select({ user: users, facilityId: facilities.id })
    .from(users)
    .innerJoin(facilities, eq(users.facilityId, facilities.id))
    .where(
      and(
        eq(facilities.accreNo, accreNo),
        eq(facilities.active, true),
        eq(users.username, username),
        eq(users.active, true),
      ),
    )
    .limit(1);

  if (!account) {
    await verifyPassword(password, await dummyHash);
    await audit({ action: "login.failed", details: { accreNo } });
    return failed;
  }

  const { user, facilityId } = account;
  const actor = { facilityId, userId: user.id };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ ...actor, action: "login.locked" });
    return {
      values,
      error: "This account is locked after too many attempts. Try again in 15 minutes.",
    };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLoginCount: lock ? 0 : sql`${users.failedLoginCount} + 1`,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
      })
      .where(eq(users.id, user.id));
    await audit({ ...actor, action: "login.failed" });
    return failed;
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(users.id, user.id));
  await createSession(user.id);
  await audit({ ...actor, action: "login.success" });
  redirect("/");
}
