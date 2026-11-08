"use server";

import { requireUser } from "@/server/auth/session";
import {
  selectionEvidence,
  submitSelection,
  type SelectionInput,
} from "@/server/selection/service";

export async function evidenceAction(pin: string) {
  return selectionEvidence(await requireUser(), pin);
}

export async function submitSelectionAction(input: SelectionInput) {
  return submitSelection(await requireUser(), input);
}
