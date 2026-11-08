"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import {
  createStaff,
  resetStaffPassword,
  setCipherKey,
  setStaffActive,
  type NewStaffInput,
} from "@/server/admin/service";

export async function createStaffAction(input: NewStaffInput) {
  const result = await createStaff(await requireAdmin(), input);
  revalidatePath("/admin");
  return result;
}

export async function setActiveAction(id: string, active: boolean) {
  const result = await setStaffActive(await requireAdmin(), id, active);
  revalidatePath("/admin");
  return result;
}

export async function resetPasswordAction(id: string, password: string) {
  return resetStaffPassword(await requireAdmin(), id, password);
}

export async function setCipherKeyAction(key: string) {
  const result = await setCipherKey(await requireAdmin(), key);
  revalidatePath("/admin");
  return result;
}
