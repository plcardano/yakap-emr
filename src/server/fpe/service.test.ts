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

  it("backs off as the guide says", () => {
    expect([0, 1, 2, 5, 6, 20].map(poller.pollDelaySeconds)).toEqual([2, 4, 8, 60, 60, 60]);
  });
});
