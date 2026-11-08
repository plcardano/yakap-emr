"use server";

import { requireUser } from "@/server/auth/session";
import { fetchAvailmentSlip, type SlipInput } from "@/server/records/service";

export async function fetchSlipAction(input: SlipInput) {
  return fetchAvailmentSlip(await requireUser(), input);
}
