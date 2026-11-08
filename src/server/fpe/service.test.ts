import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_CERT_ID, MOCK_FACILITIES, MOCK_SECRET_KEY } from "../../../mock/pcapi/config";
import { createMockPcapi } from "../../../mock/pcapi/server";
import { validSample } from "../../../tests/fixtures/samples";
import type { Values } from "@/lib/fpe/form";
import type { Actor } from "./service";

const ACCRE = "H22223333";

// Needs the Docker database, so it is skipped where DATABASE_URL is not set, as in CI.
describe.runIf(process.env.DATABASE_URL)("Selection and FPE", () => {
  const mock = createMockPcapi({ processDelayMs: 5 });
  let actor: Actor;
  let fpe: typeof import("./service");
  let selection: typeof import("@/server/selection/service");
  let verification: typeof import("@/server/verification/service");
  let poller: typeof import("@/server/uploads/poller");
  let t: typeof import("@/server/db/schema");
  let db: typeof import("@/server/db").db;
  let today: string;
  let seed = 200000000000;

  const newPin = () => String(++seed);

  beforeAll(async () => {
    process.env.PCAPI_BASE_URL = await mock.listen();
    process.env.PCAPI_SOFTWARE_CERT_ID = MOCK_CERT_ID;
    process.env.PCAPI_SECRET_KEY = MOCK_SECRET_KEY;

    t = await import("@/server/db/schema");
    ({ db } = await import("@/server/db"));
    fpe = await import("./service");
    selection = await import("@/server/selection/service");
    verification = await import("@/server/verification/service");
    poller = await import("@/server/uploads/poller");
    const { encryptAtRest } = await import("@/server/crypto/at-rest");
    today = (await import("@/server/pcapi/today")).todayUs();

    const [facility] = await db
      .insert(t.facilities)
      .values({
        accreNo: ACCRE,
        name: "FPE test",
        cipherKeyEncrypted: encryptAtRest(MOCK_FACILITIES[ACCRE]),
      })
      .returning();
    const [user] = await db
      .insert(t.users)
      .values({
        facilityId: facility.id,
        username: `fpe-${randomBytes(4).toString("hex")}`,
        displayName: "Test",
        passwordHash: "x",
      })
      .returning();
    actor = { id: user.id, facilityId: facility.id, accreNo: ACCRE, username: user.username };
  });

  afterAll(async () => {
    const where = (table: { facilityId: never }) => eq(table.facilityId, actor.facilityId);
    for (const table of [
      t.auditLog,
      t.consentRecords,
      t.patientVerifications,
      t.drafts,
      t.submissions,
      t.patientCases,
      t.recordCounters,
      t.users,
    ]) {
      await db.delete(table).where(where(table as never));
    }
    await db.delete(t.facilities).where(eq(t.facilities.id, actor.facilityId));
    await mock.close();
  });

  const verify = (pin: string) =>
    verification.validateVerificationCode(actor, {
      patient_pin: pin,
      one_time_pin: "123456",
      transaction_date: today,
      consent: true,
    });

  const select = (pin: string) =>
    selection.submitSelection(actor, {
      patient_pin: pin,
      selection_date: today,
      mode: "OTP",
      consent: true,
    });

  async function assignedPatient() {
    const pin = newPin();
    await verify(pin);
    expect((await select(pin)).ok).toBe(true);
    return pin;
  }

  async function newDraft(pin: string) {
    const created = await fpe.createFpeDraft(actor, { patient_pin: pin, consent: true });
    if (!created.ok) throw new Error(created.title);
    const content = await fpe.loadFpeDraft(actor, created.data.draftId);
    return { id: created.data.draftId, values: content!.values };
  }

  function complete(prefilled: Values): Values {
    const sample = validSample("fpe");
    return {
      ...sample,
      enlistment: { ...sample.enlistment, ...prefilled.enlistment },
      profile: { ...sample.profile, patient_verification_mode: "OTP" },
    };
  }

  async function submitted(pin: string, change?: (values: Values) => void) {
    const draft = await newDraft(pin);
    const values = complete(draft.values);
    change?.(values);
    const result = await fpe.submitFpe(actor, { draftId: draft.id, values, consent: true });
    if (!result.ok) throw new Error(`${result.title} ${JSON.stringify(result.fieldErrors)}`);
    return result.data.submissionId;
  }

  async function row(id: string) {
    const [submission] = await db.select().from(t.submissions).where(eq(t.submissions.id, id));
    return submission;
  }

  async function settle(id: string) {
    for (let i = 0; i < 100; i++) {
      await db
        .update(t.submissions)
        .set({ nextPollAt: new Date(0) })
        .where(eq(t.submissions.id, id));
      await poller.pollDueUploads();
      const current = await row(id);
      if (current.processingStatus === "accepted" || current.processingStatus === "rejected") {
        return current;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Did not settle");
  }

  describe("Selection", () => {
    it("needs a verification completed today", async () => {
      expect(await select(newPin())).toMatchObject({
        ok: false,
        fieldErrors: { mode: expect.any(String) },
      });
    });

    it("records the selection and refuses a repeat", async () => {
      const pin = newPin();
      await verify(pin);
      expect(await selection.selectionEvidence(actor, pin)).toEqual(["OTP"]);
      expect(await select(pin)).toMatchObject({
        ok: true,
        data: { selection: { status: "ASSIGNED" } },
      });
      expect(await select(pin)).toMatchObject({
        ok: false,
        title: "Already assigned to your clinic",
      });
    });

    it("refuses a future date", async () => {
      const result = await selection.submitSelection(actor, {
        patient_pin: newPin(),
        selection_date: "12/31/2099",
        mode: "OTP",
        consent: true,
      });
      expect(result).toMatchObject({ ok: false, fieldErrors: { selection_date: expect.any(String) } });
    });
  });

  describe("FPE", () => {
    it("will not start for a beneficiary not assigned to the clinic", async () => {
      expect(
        await fpe.createFpeDraft(actor, { patient_pin: newPin(), consent: true }),
      ).toMatchObject({ ok: false, title: "Not assigned to your clinic" });
    });

    it("prefills the draft from the Masterlist and stores it encrypted", async () => {
      const pin = await assignedPatient();
      const { id, values } = await newDraft(pin);
      expect(values.enlistment).toMatchObject({ patient_pin: pin, patient_sex: "F" });
      const [stored] = await db.select().from(t.drafts).where(eq(t.drafts.id, id));
      expect(stored.payloadEncrypted).not.toContain(pin);
    });

    it("saves progress", async () => {
      const { id, values } = await newDraft(await assignedPatient());
      expect(await fpe.saveFpeDraft(actor, id, { ...values, marker: 1 }, 3)).toBe(true);
      expect(await fpe.loadFpeDraft(actor, id)).toMatchObject({ step: 3, values: { marker: 1 } });
    });

    it("reports fields to fix without sending", async () => {
      const draft = await newDraft(await assignedPatient());
      const result = await fpe.submitFpe(actor, {
        draftId: draft.id,
        values: draft.values,
        consent: true,
      });
      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { "profile.fpe_date": expect.any(String) },
      });
    });

    it("needs consent to submit", async () => {
      const draft = await newDraft(await assignedPatient());
      expect(
        await fpe.submitFpe(actor, { draftId: draft.id, values: complete(draft.values), consent: false }),
      ).toMatchObject({ ok: false, fieldErrors: { consent: expect.any(String) } });
    });

    it("uploads, removes the draft, and the worker records acceptance", async () => {
      const id = await submitted(await assignedPatient());
      const queued = await row(id);
      expect(queued.processingStatus).toBe("queued");
      expect(queued.uploadTransactionNo).toHaveLength(23);
      expect(queued.payloadEncrypted).toMatch(/^v1\./);

      const done = await settle(id);
      expect(done.processingStatus).toBe("accepted");
      expect(done.nextPollAt).toBeNull();
      expect(done.processedAt).not.toBeNull();

      const list = await fpe.listFpe(actor);
      expect(list.find((item) => item.id === id)?.status).toBe("accepted");
    });

    it("issues one case number per patient", async () => {
      const pin = await assignedPatient();
      const first = await row(await submitted(pin));
      const second = await row(await submitted(pin));
      const numbers = (r: typeof first) => r.recordNumbers as { case_no: string; profile_transaction_no: string };
      expect(numbers(first).case_no).toBe(numbers(second).case_no);
      expect(numbers(first).profile_transaction_no).not.toBe(numbers(second).profile_transaction_no);
    });

    it("corrects a rejected record under the same numbers", async () => {
      const pin = await assignedPatient();
      const id = await submitted(pin, (values) => {
        values.enlistment.patient_lname = "REJECT";
      });
      const rejected = await settle(id);
      expect(rejected.processingStatus).toBe("rejected");
      expect(rejected.errors).toEqual([
        { field: "enlistment.patient_lname", issue: "validation_error" },
      ]);

      const draftId = (await fpe.correctFpeSubmission(actor, id))!;
      const content = (await fpe.loadFpeDraft(actor, draftId))!;
      content.values.enlistment.patient_lname = "DELA CRUZ";
      const result = await fpe.submitFpe(actor, {
        draftId,
        values: content.values,
        consent: true,
      });
      if (!result.ok) throw new Error(result.title);

      const corrected = await settle(result.data.submissionId);
      expect(corrected.processingStatus).toBe("accepted");
      expect(corrected.recordKey).toBe(rejected.recordKey);
      expect((await row(id)).supersededAt).not.toBeNull();
      expect((await fpe.listFpe(actor)).some((item) => item.id === id)).toBe(false);
    });

    it("cannot correct an accepted record", async () => {
      const id = await submitted(await assignedPatient());
      await settle(id);
      expect(await fpe.correctFpeSubmission(actor, id)).toBeNull();
    });
  });

  describe("Empanelment", () => {
    let empanelment: typeof import("@/server/empanelment/service");
    beforeAll(async () => {
      empanelment = await import("@/server/empanelment/service");
    });

    const lookup = (patient_pin: string) => ({
      patient_pin,
      eff_year: "",
      first_name: "",
      last_name: "",
      middle_name: "",
      patient_dob: "",
      consent: true,
    });
    const record = (patient_pin: string, overrides = {}) =>
      empanelment.recordEmpanelment(actor, {
        patient_pin,
        mode: "OTP",
        consent: true,
        ...overrides,
      });
    const tracker = async (pin: string) => {
      const result = await empanelment.loadTracker(actor, lookup(pin));
      if (!result.ok) throw new Error(result.title);
      return result.data;
    };

    it("needs consent and a mode", async () => {
      expect(await record(newPin(), { consent: false, mode: "" })).toMatchObject({
        ok: false,
        fieldErrors: { consent: expect.any(String), mode: expect.any(String) },
      });
    });

    it("needs verification from today", async () => {
      expect(await record(newPin())).toMatchObject({
        ok: false,
        fieldErrors: { mode: "This verification was not completed today." },
      });
    });

    it("is refused without an active selection", async () => {
      const pin = newPin();
      await verify(pin);
      expect(await record(pin)).toMatchObject({
        ok: false,
        title: "No active Selection at your clinic",
      });
    });

    it("waits for an accepted FPE, then records and reads the status back", async () => {
      const pin = await assignedPatient();
      expect(await record(pin)).toMatchObject({ ok: false, title: "No accepted FPE at your clinic" });

      const id = await submitted(pin);
      expect((await tracker(pin)).fpeUpload).toBe("queued");
      await settle(id);
      expect((await tracker(pin)).validator.fpe.status).toBe("Y");

      const result = await record(pin);
      expect(result).toMatchObject({
        ok: true,
        data: {
          referenceNo: expect.stringMatching(/^MCA/),
          validator: { empanelment: { status: "Y" } },
        },
      });

      expect(await record(pin)).toMatchObject({
        ok: false,
        title: "The agreement is already recorded",
      });
    });

    it("shows a rejected FPE upload", async () => {
      const pin = await assignedPatient();
      await settle(
        await submitted(pin, (values) => {
          values.enlistment.patient_lname = "REJECT";
        }),
      );
      expect((await tracker(pin)).fpeUpload).toBe("rejected");
    });

    it("shows which verification modes are available today", async () => {
      const pin = newPin();
      await verify(pin);
      expect((await tracker(pin)).evidence).toEqual(["OTP"]);
    });
  });

  describe("Clinical uploads", () => {
    let clinical: typeof import("@/server/uploads/clinical");
    let uploads: typeof import("@/server/uploads/service");

    beforeAll(async () => {
      clinical = await import("@/server/uploads/clinical");
      uploads = await import("@/server/uploads/service");
    });

    async function draftValues(id: string) {
      return (await uploads.loadDraft(actor, id))!.content.values;
    }

    async function send(draftId: string, values: Values) {
      const result = await uploads.submitDraft(actor, { draftId, values, consent: true });
      if (!result.ok) throw new Error(`${result.title} ${JSON.stringify(result.fieldErrors)}`);
      return settle(result.data.submissionId);
    }

    async function acceptedConsultation(pin: string) {
      await settle(await submitted(pin));
      const created = await clinical.createConsultationDraft(actor, { patient_pin: pin, consent: true });
      if (!created.ok) throw new Error(created.title);
      const prefilled = await draftValues(created.data.draftId);
      const sample = validSample("consultation");
      const values = {
        ...sample,
        __patient: prefilled.__patient,
        soap: {
          ...sample.soap,
          ...prefilled.soap,
          patient_verification_mode: "OTP",
        },
        management: { ...sample.management, diagnostic_services_flag: "Y" },
      };
      return send(created.data.draftId, values);
    }

    it("needs an FPE before a consultation", async () => {
      const pin = await assignedPatient();
      expect(
        await clinical.createConsultationDraft(actor, { patient_pin: pin, consent: true }),
      ).toMatchObject({ ok: false, title: "This patient has no FPE at your clinic" });
    });

    it("runs a consultation and all of its child records", async () => {
      const pin = await assignedPatient();
      const consultation = await acceptedConsultation(pin);
      expect(consultation.processingStatus).toBe("accepted");
      const parentNumbers = consultation.recordNumbers as Record<string, string>;

      const listed = (await uploads.listUploads(actor, ["consultation"])).find(
        (item) => item.id === consultation.id,
      );
      expect(listed?.flags).toEqual({ diagnostics: true, medicine: true, referral: true });

      // Diagnostic Request
      const requestDraft = (await clinical.createChildDraft(actor, consultation.id, "diagnostic_request"))!;
      const requestSample = validSample("diagnostic_request");
      const request = await send(requestDraft, {
        ...(await draftValues(requestDraft)),
        diagrequest: requestSample.diagrequest,
      });
      expect(request.processingStatus).toBe("accepted");
      expect((request.recordNumbers as Record<string, string>).soap_transaction_no).toBe(
        parentNumbers.soap_transaction_no,
      );

      // Diagnostic Results start with one row per requested test
      const resultsDraft = (await clinical.createChildDraft(actor, request.id, "diagnostic_results"))!;
      const resultValues = await draftValues(resultsDraft);
      expect(resultValues.diagresult_item.map((row: Values) => row.diagnostic_code)).toEqual(
        requestSample.diagrequest.map((row: Values) => row.diagnostic_code),
      );
      const resultsSample = validSample("diagnostic_results");
      const results = await send(resultsDraft, {
        ...resultValues,
        diagresult_item: resultsSample.diagresult_item,
      });
      expect(results.processingStatus).toBe("accepted");

      // Medicine prefills from the consultation
      const medicineDraft = (await clinical.createChildDraft(actor, consultation.id, "medicine"))!;
      const medicineValues = await draftValues(medicineDraft);
      expect(medicineValues.physiciansignoff.physician_name).toBeTruthy();
      expect(
        (await send(medicineDraft, { ...medicineValues, medicine: validSample("medicine").medicine }))
          .processingStatus,
      ).toBe("accepted");

      // Referral repeats the consultation's header
      const referralDraft = (await clinical.createChildDraft(actor, consultation.id, "referral"))!;
      const referralValues = await draftValues(referralDraft);
      expect(referralValues.soap.patient_pin).toBe(pin);
      expect(referralValues.soap.patient_age).toMatch(/YR\(S\)/);
      const referral = await send(referralDraft, {
        ...referralValues,
        referral: validSample("referral").referral,
      });
      expect(referral.processingStatus).toBe("accepted");
      expect(referral.parentSubmissionId).toBe(consultation.id);

      // One consultation may raise several referrals.
      const second = (await clinical.createChildDraft(actor, consultation.id, "referral"))!;
      expect(
        (
          await send(second, {
            ...(await draftValues(second)),
            referral: validSample("referral").referral,
          })
        ).recordKey,
      ).not.toBe(referral.recordKey);
    });

    it("will not start a child record from a parent that is not accepted", async () => {
      const id = await submitted(await assignedPatient());
      expect(await clinical.createChildDraft(actor, id, "medicine")).toBeNull();
    });

    it("cannot correct an accepted consultation", async () => {
      const pin = await assignedPatient();
      const first = await acceptedConsultation(pin);
      expect(first.processingStatus).toBe("accepted");
      expect(await uploads.correctSubmission(actor, first.id)).toBeNull();
    });
  });

  it("backs off as the guide says", () => {
    expect([0, 1, 2, 5, 6, 20].map(poller.pollDelaySeconds)).toEqual([2, 4, 8, 60, 60, 60]);
  });
});
