import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { ageText } from "@/lib/fpe/derived";
import type { UploadForm } from "@/lib/pcapi-spec";
import type { Values } from "@/lib/upload-forms/types";
import { pcapiFor } from "@/server/pcapi";
import { failureCode, fieldFailure, requestIdOf, toFailure } from "@/server/verification/failure";
import {
  caseNumberFor,
  createDraft,
  loadParent,
  logEntry,
  recordConsent,
  type Actor,
} from "./service";

const OBJECT_GROUPS = [
  "soap",
  "subjective",
  "allergy",
  "currentmed",
  "sochist",
  "sexhist",
  "ros",
  "pegensurvey",
  "pepert",
  "pemisc",
  "physiciansignoff",
  "diagnosis",
  "management",
];
const ARRAY_GROUPS = ["medhist", "immunizationhist", "famhist"];

function patientName(row: { patient_lname: string; patient_fname: string }) {
  return `${row.patient_lname}, ${row.patient_fname}`;
}

export async function createConsultationDraft(
  actor: Actor,
  input: { patient_pin: string; consent: boolean },
): Promise<ActionResult<{ draftId: string }>> {
  if (!input.consent) return fieldFailure({ consent: "Confirm the patient's consent first." });
  if (!/^\d{12}$/.test(input.patient_pin)) {
    return fieldFailure({ patient_pin: "Enter exactly 12 digits, with no dashes or spaces." });
  }

  await recordConsent(actor, input.patient_pin, "consultation");
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).masterlistIndividual({
      patient_pin: input.patient_pin,
      eff_year: "",
      consent: true,
    });

    // case_no is that of the patient's FPE record (guide 4.6.2).
    if (!(await caseNumberFor(actor, input.patient_pin, false))) {
      return {
        ok: false,
        title: "This patient has no FPE at your clinic",
        body: "Submit the First Patient Encounter first.",
      };
    }

    const row = data.assignments[0];
    const values: Values = {
      ...Object.fromEntries(OBJECT_GROUPS.map((group) => [group, {}])),
      ...Object.fromEntries(ARRAY_GROUPS.map((group) => [group, [{}]])),
      soap: { patient_pin: row.patient_pin, patient_type: row.patient_type },
      __patient: {
        pin: row.patient_pin,
        name: patientName(row),
        dob: row.patient_dob,
        sex: row.patient_sex,
      },
      __forms: { obgyne: false, pedia: false, adol: false, headsss: false, bp: false },
    };
    const draftId = await createDraft(actor, "consultation", input.patient_pin, { values, step: 0 });
    await logEntry(actor, "consultation.draft_created", { patient_pin: input.patient_pin }, requestId);
    return { ok: true, data: { draftId }, requestId };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.masterlist.failed",
      { patient_pin: input.patient_pin, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

export type ChildForm = "diagnostic_request" | "diagnostic_results" | "medicine" | "referral";

const REFERRAL_HEADER = [
  "patient_type",
  "patient_pin",
  "patient_age",
  "method_of_service_delivery",
  "co_payment_flag",
  "co_payment_date_payment",
  "co_payment",
  "co_payment_balance",
  "consultation_date",
  "consultation_time",
];

function pick(source: Values, keys: string[]) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

/** Starts a child record from its accepted parent. Null if the parent is not usable. */
export async function createChildDraft(actor: Actor, parentId: string, form: ChildForm) {
  const parentForm: UploadForm = form === "diagnostic_results" ? "diagnostic_request" : "consultation";
  const parent = await loadParent(actor, parentId, parentForm);
  if (!parent) return null;

  const { values: source, numbers, pcuCode } = parent.payload;
  const shared = { __patient: source.__patient };
  const physician = source.physiciansignoff ?? source.__physician ?? {};

  const values: Values = {
    diagnostic_request: () => ({
      ...shared,
      __physician: physician,
      diagrequest: [{}],
    }),
    diagnostic_results: () => ({
      ...shared,
      diagnosticresult: {},
      physiciansignoff: physician,
      diagresult_item: source.diagrequest.map((row: Values) => ({
        diagnostic_code: row.diagnostic_code,
      })),
    }),
    medicine: () => ({
      ...shared,
      physiciansignoff: physician,
      medicine: [{ prescription_date: source.soap.consultation_date, is_applicable: "Y" }],
    }),
    referral: () => ({
      ...shared,
      soap: pick(
        {
          ...source.soap,
          patient_age:
            ageText(source.__patient?.dob, source.soap.consultation_date) ||
            source.soap.patient_age,
        },
        REFERRAL_HEADER,
      ),
      ...(source.guardian && { guardian: source.guardian }),
      referral: {},
      physiciansignoff: physician,
    }),
  }[form]();

  return createDraft(actor, form, String(source.__patient?.pin ?? source.soap?.patient_pin ?? ""), {
    values,
    step: 0,
    parent: { submissionId: parentId, numbers, pcuCode },
  });
}

