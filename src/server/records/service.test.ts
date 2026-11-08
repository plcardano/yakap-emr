import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_CERT_ID, MOCK_FACILITIES, MOCK_SECRET_KEY } from "../../../mock/pcapi/config";
import { createMockPcapi } from "../../../mock/pcapi/server";
import type { Actor } from "@/server/verification/service";

const ACCRE = "H33334444";

// Needs the Docker database, so it is skipped where DATABASE_URL is not set, as in CI.
describe.runIf(process.env.DATABASE_URL)("clinic records", () => {
  const mock = createMockPcapi({ processDelayMs: 5 });
  let actor: Actor & { username: string };
  let records: typeof import("./service");
  let t: typeof import("@/server/db/schema");
  let db: typeof import("@/server/db").db;
  let today: string;
  let seed = 300000000000;
  const newPin = () => String(++seed);

  beforeAll(async () => {
    process.env.PCAPI_BASE_URL = await mock.listen();
    process.env.PCAPI_SOFTWARE_CERT_ID = MOCK_CERT_ID;
    process.env.PCAPI_SECRET_KEY = MOCK_SECRET_KEY;
    t = await import("@/server/db/schema");
    ({ db } = await import("@/server/db"));
    records = await import("./service");
    today = (await import("@/server/pcapi/today")).todayUs();
    const { encryptAtRest } = await import("@/server/crypto/at-rest");

    const [facility] = await db
      .insert(t.facilities)
      .values({
        accreNo: ACCRE,
        name: "Records test",
        cipherKeyEncrypted: encryptAtRest(MOCK_FACILITIES[ACCRE]),
      })
      .returning();
    const [user] = await db
      .insert(t.users)
      .values({
        facilityId: facility.id,
        username: `rec-${randomBytes(4).toString("hex")}`,
        displayName: "Test",
        passwordHash: "x",
      })
      .returning();
    actor = { id: user.id, facilityId: facility.id, accreNo: ACCRE, username: user.username };
  });

  afterAll(async () => {
    for (const table of [t.auditLog, t.consentRecords, t.patientVerifications, t.users]) {
      await db.delete(table).where(eq((table as typeof t.users).facilityId, actor.facilityId));
    }
    await db.delete(t.facilities).where(eq(t.facilities.id, actor.facilityId));
    await mock.close();
  });

  async function assigned() {
    const pin = newPin();
    const verification = await import("@/server/verification/service");
    const selection = await import("@/server/selection/service");
    await verification.validateVerificationCode(actor, {
      patient_pin: pin,
      one_time_pin: "123456",
      transaction_date: today,
      consent: true,
    });
    const result = await selection.submitSelection(actor, {
      patient_pin: pin,
      selection_date: today,
      mode: "OTP",
      consent: true,
    });
    expect(result.ok).toBe(true);
    return pin;
  }

  const individual = (patient_pin: string, overrides = {}) =>
    records.lookupAssignment(actor, { patient_pin, eff_year: "", consent: true, ...overrides });
  const batch = (start_date: string, end_date: string, consent = true) =>
    records.downloadBatch(actor, { start_date, end_date, consent });
  const slip = (patient_pin: string, overrides = {}) =>
    records.fetchAvailmentSlip(actor, { patient_pin, eff_year: "2026", consent: true, ...overrides });

  it("finds an assigned beneficiary", async () => {
    const pin = await assigned();
    expect(await individual(pin)).toMatchObject({
      ok: true,
      data: { total_records: 1, assignments: [{ patient_pin: pin, assignment_status: "1" }] },
    });
  });

  it("reports a beneficiary not assigned to the clinic", async () => {
    expect(await individual(newPin())).toMatchObject({
      ok: false,
      title: "Not assigned to your clinic",
    });
  });

  it("needs consent and a well-formed PIN", async () => {
    expect(await individual(newPin(), { consent: false })).toMatchObject({
      ok: false,
      fieldErrors: { consent: expect.any(String) },
    });
    expect(await individual("12")).toMatchObject({
      ok: false,
      fieldErrors: { patient_pin: expect.any(String) },
    });
  });

  it("downloads a date range", async () => {
    const pin = await assigned();
    const result = await batch(today, today);
    expect(result.ok && result.data.assignments.some((row) => row.patient_pin === pin)).toBe(true);
  });

  it("returns an empty list when nothing matches", async () => {
    expect(await batch("01/01/2020", "01/07/2020")).toMatchObject({
      ok: true,
      data: { total_records: 0, assignments: [] },
    });
  });

  it("allows exactly 7 days and refuses 8, or a reversed range", async () => {
    expect((await batch("10/01/2026", "10/07/2026")).ok).toBe(true);
    expect(await batch("10/01/2026", "10/08/2026")).toMatchObject({
      ok: false,
      fieldErrors: { end_date: "The range can cover at most 7 days." },
    });
    expect(await batch("10/08/2026", "10/01/2026")).toMatchObject({
      ok: false,
      fieldErrors: { end_date: "The end date cannot be before the start date." },
    });
  });

  it("returns the slip as a PDF with the guide's file name", async () => {
    const pin = await assigned();
    const result = await slip(pin);
    if (!result.ok) throw new Error(result.title);
    const bytes = Buffer.from(result.data.base64, "base64");
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(result.data.fileName).toBe(`availment_slip_${pin}_2026.pdf`);
  });

  it("needs a year for the slip and reports no slip", async () => {
    expect(await slip(newPin(), { eff_year: "" })).toMatchObject({
      ok: false,
      fieldErrors: { eff_year: expect.any(String) },
    });
    expect(await slip(newPin())).toMatchObject({ ok: false, title: "No Availment Slip is available" });
  });
});
