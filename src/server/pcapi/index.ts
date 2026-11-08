import "server-only";
import { eq } from "drizzle-orm";
import { decryptAtRest } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { facilities } from "@/server/db/schema";
import { PcapiClient } from "./client";
import { pcapiServices } from "./services";

function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function cipherKeyFor(accreNo: string) {
  const [facility] = await db
    .select({ cipherKeyEncrypted: facilities.cipherKeyEncrypted })
    .from(facilities)
    .where(eq(facilities.accreNo, accreNo))
    .limit(1);
  if (!facility?.cipherKeyEncrypted) {
    throw new Error(`No cipher key is stored for facility ${accreNo}`);
  }
  return decryptAtRest(facility.cipherKeyEncrypted);
}

// Tokens are cached per facility, so one client serves the whole process.
const globalForPcapi = globalThis as unknown as { yakapPcapi?: PcapiClient };

function client() {
  globalForPcapi.yakapPcapi ??= new PcapiClient({
    baseUrl: requireEnv("PCAPI_BASE_URL"),
    softwareCertId: requireEnv("PCAPI_SOFTWARE_CERT_ID"),
    secretKey: requireEnv("PCAPI_SECRET_KEY"),
    cipherKeyFor,
  });
  return globalForPcapi.yakapPcapi;
}

export function pcapiFor(accreNo: string) {
  return pcapiServices(client(), accreNo);
}
