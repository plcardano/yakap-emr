import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { hashPassword } from "../src/server/auth/password";
import { encryptAtRest } from "../src/server/crypto/at-rest";
import { facilities, users } from "../src/server/db/schema";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

async function main() {
  const accreNo = required("SEED_FACILITY_ACCRE_NO");
  if (accreNo.length !== 9) throw new Error("accre_no must be 9 characters");

  const sql = postgres(required("DATABASE_URL"), { max: 1 });
  const db = drizzle({ client: sql });

  const details = {
    name: required("SEED_FACILITY_NAME"),
    cipherKeyEncrypted: encryptAtRest(required("SEED_FACILITY_CIPHER_KEY")),
  };
  const [facility] = await db
    .insert(facilities)
    .values({ accreNo, ...details })
    .onConflictDoUpdate({ target: facilities.accreNo, set: details })
    .returning();

  const passwordHash = await hashPassword(required("SEED_ADMIN_PASSWORD"));
  await db
    .insert(users)
    .values({
      facilityId: facility.id,
      username: required("SEED_ADMIN_USERNAME"),
      displayName: "Administrator",
      passwordHash,
      role: "admin",
    })
    .onConflictDoUpdate({
      target: [users.facilityId, users.username],
      set: { passwordHash, role: "admin", active: true },
    });

  await sql.end();
  console.log(`Seeded facility ${accreNo} and its admin account.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
