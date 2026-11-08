"use server";

import { redirect } from "next/navigation";
import { audit } from "@/server/audit/log";
import { destroySession, getCurrentUser } from "@/server/auth/session";

export async function logout() {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await audit({ action: "logout", facilityId: user.facilityId, userId: user.id });
  }
  redirect("/login");
}
