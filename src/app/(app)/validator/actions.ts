"use server";

import { requireUser } from "@/server/auth/session";
import { lookupBeneficiary, type LookupInput } from "@/server/verification/service";

export async function lookupAction(input: LookupInput) {
  return lookupBeneficiary(await requireUser(), input);
}
