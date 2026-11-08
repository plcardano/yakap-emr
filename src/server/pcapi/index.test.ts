import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_CERT_ID, MOCK_FACILITIES, MOCK_SECRET_KEY } from "../../../mock/pcapi/config";
import { createMockPcapi } from "../../../mock/pcapi/server";

const ACCRE = "H87654321";

// Needs the Docker database, so it is skipped where DATABASE_URL is not set, as in CI.
describe.runIf(process.env.DATABASE_URL)("pcapiFor", () => {
  const mock = createMockPcapi({ processDelayMs: 5 });

  beforeAll(async () => {
    process.env.PCAPI_BASE_URL = await mock.listen();
    process.env.PCAPI_SOFTWARE_CERT_ID = MOCK_CERT_ID;
    process.env.PCAPI_SECRET_KEY = MOCK_SECRET_KEY;

    const { db } = await import("@/server/db");
    const { facilities } = await import("@/server/db/schema");
    const { encryptAtRest } = await import("@/server/crypto/at-rest");
    await db.insert(facilities).values({
      accreNo: ACCRE,
      name: "PCAPI wiring test",
      cipherKeyEncrypted: encryptAtRest(MOCK_FACILITIES[ACCRE]),
    });
  });

  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { facilities } = await import("@/server/db/schema");
    await db.delete(facilities).where(eq(facilities.accreNo, ACCRE));
    await mock.close();
  });

  it("uses the facility's stored cipher key", async () => {
    const { pcapiFor } = await import(".");
    const { data } = await pcapiFor(ACCRE).validator({
      patient_pin: "123456789012",
      consent: true,
    });
    expect(data.accre_no).toBe(ACCRE);
  });
});
