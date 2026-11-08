import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  MOCK_CERT_ID,
  MOCK_FACILITIES,
  MOCK_SECRET_KEY,
  SCENARIO_PINS,
} from "../../../mock/pcapi/config";
import { createMockPcapi } from "../../../mock/pcapi/server";
import type { Actor } from "./service";

const ACCRE = "H11112222";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

// Needs the Docker database, so it is skipped where DATABASE_URL is not set, as in CI.
describe.runIf(process.env.DATABASE_URL)("verification services", () => {
  const mock = createMockPcapi({ processDelayMs: 5 });
  let actor: Actor;
  let service: typeof import("./service");
  let tables: typeof import("@/server/db/schema");
  let db: typeof import("@/server/db").db;

  const rowsFor = () =>
    db
      .select()
      .from(tables.patientVerifications)
      .where(eq(tables.patientVerifications.facilityId, actor.facilityId));

  beforeAll(async () => {
    process.env.PCAPI_BASE_URL = await mock.listen();
    process.env.PCAPI_SOFTWARE_CERT_ID = MOCK_CERT_ID;
    process.env.PCAPI_SECRET_KEY = MOCK_SECRET_KEY;

    tables = await import("@/server/db/schema");
    ({ db } = await import("@/server/db"));
    service = await import("./service");
    const { encryptAtRest } = await import("@/server/crypto/at-rest");

    const [facility] = await db
      .insert(tables.facilities)
      .values({
        accreNo: ACCRE,
        name: "Verification test",
        cipherKeyEncrypted: encryptAtRest(MOCK_FACILITIES[ACCRE]),
      })
      .returning();
    const [user] = await db
      .insert(tables.users)
      .values({
        facilityId: facility.id,
        username: `test-${randomBytes(4).toString("hex")}`,
        displayName: "Test",
        passwordHash: "x",
      })
      .returning();
    actor = { id: user.id, facilityId: facility.id, accreNo: ACCRE };
  });

  afterAll(async () => {
    const { auditLog, consentRecords, patientVerifications, users, facilities } = tables;
    await db.delete(auditLog).where(eq(auditLog.facilityId, actor.facilityId));
    await db.delete(consentRecords).where(eq(consentRecords.facilityId, actor.facilityId));
    await db
      .delete(patientVerifications)
      .where(eq(patientVerifications.facilityId, actor.facilityId));
    await db.delete(users).where(eq(users.facilityId, actor.facilityId));
    await db.delete(facilities).where(eq(facilities.id, actor.facilityId));
    await mock.close();
  });

  const lookup = (overrides = {}) => ({
    patient_pin: "123456789012",
    eff_year: "",
    first_name: "",
    last_name: "",
    middle_name: "",
    patient_dob: "",
    consent: true,
    ...overrides,
  });

  const pcu = (overrides = {}) => ({
    pin: "123456789012",
    first_name: "JUAN",
    middle_name: "",
    last_name: "DELA CRUZ",
    suffix: "",
    birth_date: "01/31/1990",
    consent: true,
    ...overrides,
  });

  async function consentCount() {
    return (
      await db
        .select()
        .from(tables.consentRecords)
        .where(eq(tables.consentRecords.facilityId, actor.facilityId))
    ).length;
  }

  describe("lookupBeneficiary", () => {
    it("refuses to call PCAPI or record anything without consent", async () => {
      const before = await consentCount();
      const result = await service.lookupBeneficiary(actor, lookup({ consent: false }));
      expect(result).toMatchObject({ ok: false, fieldErrors: { consent: expect.any(String) } });
      expect(await consentCount()).toBe(before);
    });

    it("records consent and returns the standing", async () => {
      const before = await consentCount();
      const result = await service.lookupBeneficiary(actor, lookup());
      expect(result).toMatchObject({
        ok: true,
        data: { selection: { status: "NOT_ASSIGNED" }, pcu: { status: "UNVERIFIED" } },
      });
      expect(await consentCount()).toBe(before + 1);
    });

    it("needs a PIN, or the full name and birth date", async () => {
      const result = await service.lookupBeneficiary(actor, lookup({ patient_pin: "" }));
      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { first_name: expect.any(String), patient_dob: expect.any(String) },
      });
    });

    it("rejects a badly formed PIN before calling PCAPI", async () => {
      expect(await service.lookupBeneficiary(actor, lookup({ patient_pin: "12" }))).toMatchObject({
        ok: false,
        fieldErrors: { patient_pin: expect.stringContaining("12 digits") },
      });
    });

    it("turns an API error into wording for staff, with the request ID", async () => {
      const result = await service.lookupBeneficiary(
        actor,
        lookup({ patient_pin: SCENARIO_PINS.notFound }),
      );
      expect(result).toMatchObject({
        ok: false,
        title: "No beneficiary found",
        requestId: expect.any(String),
      });
    });

    it("never stores the PIN in the audit log unmasked", async () => {
      await service.lookupBeneficiary(actor, lookup());
      const rows = await db
        .select()
        .from(tables.auditLog)
        .where(eq(tables.auditLog.facilityId, actor.facilityId));
      const text = JSON.stringify(rows);
      expect(text).toContain("1234-*****-12");
      expect(text).not.toContain("123456789012");
    });
  });

  describe("PhilHealth Check", () => {
    async function start(overrides = {}) {
      const result = await service.startPcuCheck(actor, pcu(overrides));
      if (!result.ok) throw new Error(result.title);
      return result.data;
    }

    it("stores the transaction number of a verified patient", async () => {
      const started = await start();
      mock.completeLiveness(started.authorization_id);
      const result = await service.verifyPcuCheck(actor, started.authorization_id);

      expect(result).toMatchObject({
        ok: true,
        data: { result_code: "105", outcome: { verified: true } },
      });
      const row = (await rowsFor()).find(
        (r) => r.livenessAuthorizationId === started.authorization_id,
      );
      expect(row).toMatchObject({ status: "verified", resultCode: "105" });
      expect(row?.pcuTransNo).toBeTruthy();
    });

    it("keeps a failed check as failed", async () => {
      const started = await start({ last_name: "NORECORD" });
      mock.completeLiveness(started.authorization_id);
      const result = await service.verifyPcuCheck(actor, started.authorization_id);
      expect(result).toMatchObject({ ok: true, data: { outcome: { verified: false } } });
      const row = (await rowsFor()).find(
        (r) => r.livenessAuthorizationId === started.authorization_id,
      );
      expect(row).toMatchObject({ status: "failed", resultCode: "108" });
    });

    it("will not submit the same attempt twice", async () => {
      const started = await start();
      mock.completeLiveness(started.authorization_id);
      await service.verifyPcuCheck(actor, started.authorization_id);
      expect(await service.verifyPcuCheck(actor, started.authorization_id)).toMatchObject({
        ok: false,
        title: "This check can no longer be used",
      });
    });

    it("marks an attempt as used when PhilHealth refuses it", async () => {
      const started = await start();
      const result = await service.verifyPcuCheck(actor, started.authorization_id);
      expect(result).toMatchObject({ ok: false, title: "This check can no longer be used" });
      const row = (await rowsFor()).find(
        (r) => r.livenessAuthorizationId === started.authorization_id,
      );
      expect(row?.status).toBe("error");
    });

    it("never keeps the launch token", async () => {
      const started = await start();
      expect(JSON.stringify(await rowsFor())).not.toContain(started.launch_token);
    });
  });

  describe("verification code", () => {
    const otp = (overrides = {}) => ({
      patient_pin: "123456789012",
      one_time_pin: "123456",
      transaction_date: "10/25/2026",
      consent: true,
      ...overrides,
    });

    it("stores a valid code encrypted", async () => {
      const result = await service.validateVerificationCode(actor, otp());
      expect(result.ok).toBe(true);
      const row = (await rowsFor()).find((r) => r.mode === "OTP");
      expect(row?.status).toBe("verified");
      expect(row?.oneTimePinEncrypted).not.toContain("123456");
    });

    it("reports a wrong code", async () => {
      expect(
        await service.validateVerificationCode(actor, otp({ one_time_pin: "999" })),
      ).toMatchObject({ ok: false, title: "The verification code is not valid" });
    });
  });

  describe("Valid ID", () => {
    const valid = (overrides = {}) => ({
      patient_pin: "123456789012",
      valid_id_type: "01",
      image: JPEG,
      consent: true,
      ...overrides,
    });

    it("stores the image encrypted", async () => {
      const type = (await import("@/lib/pcapi-spec")).libraries["Valid ID Type"][0].code;
      const result = await service.captureValidId(actor, valid({ valid_id_type: type }));
      expect(result.ok).toBe(true);
      const row = (await rowsFor()).find((r) => r.mode === "VALID_ID");
      expect(row).toMatchObject({ status: "captured", validIdType: type });
      expect(row?.validIdImageEncrypted).toMatch(/^v1\./);
    });

    it("refuses anything that is not a JPEG", async () => {
      const result = await service.captureValidId(
        actor,
        valid({ image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) }),
      );
      expect(result).toMatchObject({ ok: false, fieldErrors: { valid_id_image: expect.any(String) } });
    });

    it("refuses an image over 2 MB", async () => {
      const big = new Uint8Array(2 * 1024 * 1024 + 1);
      big.set(JPEG);
      const result = await service.captureValidId(actor, valid({ image: big }));
      expect(result).toMatchObject({
        ok: false,
        fieldErrors: { valid_id_image: expect.stringContaining("2 MB") },
      });
    });
  });
});
