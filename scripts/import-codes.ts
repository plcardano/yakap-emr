// Imports external code lists into the database. Safe to run repeatedly.
// Usage: npm run codes:import -- <file.csv>   (columns: library,code,description,parent_code)
// With no file, loads data/placeholder-codes.csv.

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { externalCodes } from "../src/server/db/schema";

const COLUMNS = ["library", "code", "description", "parent_code"];
const BATCH_SIZE = 1000;

function parseLine(line: string) {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function readRows(file: string) {
  const [header, ...lines] = readFileSync(file, "utf8").trim().split(/\r?\n/);
  if (parseLine(header).join() !== COLUMNS.join()) {
    throw new Error(`Expected the header: ${COLUMNS.join(",")}`);
  }
  return lines.map((line, index) => {
    const [library, code, description, parentCode] = parseLine(line);
    if (!library || !code || !description) {
      throw new Error(`Line ${index + 2} needs library, code and description`);
    }
    return { library, code, description, parentCode: parentCode || null };
  });
}

async function main() {
  const file = process.argv[2] ?? "data/placeholder-codes.csv";
  const rows = readRows(file);
  const client = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  const db = drizzle({ client });

  await db.transaction(async (tx) => {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await tx
        .insert(externalCodes)
        .values(rows.slice(i, i + BATCH_SIZE))
        .onConflictDoUpdate({
          target: [externalCodes.library, externalCodes.code],
          set: {
            description: sql`excluded.description`,
            parentCode: sql`excluded.parent_code`,
            active: true,
          },
        });
    }
  });

  await client.end();
  console.log(`Imported ${rows.length} codes from ${file}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
