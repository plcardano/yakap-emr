import "server-only";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { maskForLog } from "./mask";

type AuditEntry = {
  action: string;
  facilityId?: string;
  userId?: string;
  requestId?: string;
  details?: Record<string, unknown>;
};

export async function audit({ details = {}, ...entry }: AuditEntry) {
  await db.insert(auditLog).values({ ...entry, details: maskForLog(details) });
}
