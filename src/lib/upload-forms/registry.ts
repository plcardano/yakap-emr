import { FPE_DEFINITION } from "@/lib/fpe/form";
import type { UploadForm } from "@/lib/pcapi-spec/types";
import {
  DIAGNOSTIC_REQUEST_DEFINITION,
  DIAGNOSTIC_RESULTS_DEFINITION,
  MEDICINE_DEFINITION,
  REFERRAL_DEFINITION,
} from "./children";
import { CONSULTATION_DEFINITION } from "./consultation";
import type { FormDefinition } from "./types";

export const FORM_DEFINITIONS: Record<UploadForm, FormDefinition> = {
  fpe: FPE_DEFINITION,
  consultation: CONSULTATION_DEFINITION,
  diagnostic_request: DIAGNOSTIC_REQUEST_DEFINITION,
  diagnostic_results: DIAGNOSTIC_RESULTS_DEFINITION,
  medicine: MEDICINE_DEFINITION,
  referral: REFERRAL_DEFINITION,
};
