import {
  bigserial,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["admin", "staff"]);

// Values match data.form in the guide (4.6).
export const uploadForm = pgEnum("upload_form", [
  "fpe",
  "consultation",
  "diagnostic_request",
  "diagnostic_results",
  "medicine",
  "referral",
]);

// Values match data.processing_status in the guide (4.6.7).
export const processingStatus = pgEnum("processing_status", [
  "queued",
  "processing",
  "accepted",
  "rejected",
]);

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const facilities = pgTable("facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  accreNo: varchar("accre_no", { length: 9 }).notNull().unique(),
  name: varchar("name", { length: 200 }).notNull(),
  // The PCAPI cipher key for this accreditation number, encrypted at rest.
  cipherKeyEncrypted: text("cipher_key_encrypted"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    // Sent as created_by, which the guide limits to 150.
    username: varchar("username", { length: 150 }).notNull(),
    displayName: varchar("display_name", { length: 200 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRole("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("users_facility_username").on(t.facilityId, t.username)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: char("token_hash", { length: 64 }).notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// Patient PINs are stored encrypted. The HMAC allows lookup without decrypting.
export const consentRecords = pgTable(
  "consent_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    patientPinHmac: char("patient_pin_hmac", { length: 64 }).notNull(),
    patientPinEncrypted: text("patient_pin_encrypted").notNull(),
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    consentedAt: timestamp("consented_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("consent_facility_pin").on(t.facilityId, t.patientPinHmac)],
);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    form: uploadForm("form").notNull(),
    patientPinHmac: char("patient_pin_hmac", { length: 64 }),
    payloadEncrypted: text("payload_encrypted").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("drafts_facility_form").on(t.facilityId, t.form)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id),
    form: uploadForm("form").notNull(),
    uploadTransactionNo: varchar("upload_transaction_no", {
      length: 23,
    }).unique(),
    processingStatus: processingStatus("processing_status")
      .notNull()
      .default("queued"),
    recordNumbers: jsonb("record_numbers").notNull(),
    payloadEncrypted: text("payload_encrypted").notNull(),
    errors: jsonb("errors").notNull().default([]),
    requestId: uuid("request_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    pollAttempts: integer("poll_attempts").notNull().default(0),
    nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("submissions_status_poll").on(t.processingStatus, t.nextPollAt),
    index("submissions_facility_form").on(t.facilityId, t.form),
  ],
);

// Daily series for the EMR-generated record numbers (guide 3.9).
export const recordCounters = pgTable(
  "record_counters",
  {
    facilityId: uuid("facility_id")
      .notNull()
      .references(() => facilities.id),
    prefix: char("prefix", { length: 1 }).notNull(),
    counterDate: date("counter_date").notNull(),
    lastValue: integer("last_value").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.facilityId, t.prefix, t.counterDate] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    facilityId: uuid("facility_id").references(() => facilities.id),
    userId: uuid("user_id").references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    requestId: uuid("request_id"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_facility_created").on(t.facilityId, t.createdAt)],
);

// Code lists with no worksheet in the Library Reference: PSGC, ICD-10 and the Konsulta Drug Library.
export const externalCodes = pgTable(
  "external_codes",
  {
    library: varchar("library", { length: 50 }).notNull(),
    code: varchar("code", { length: 20 }).notNull(),
    description: text("description").notNull(),
    parentCode: varchar("parent_code", { length: 20 }),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.library, t.code] }),
    index("external_codes_library_parent").on(t.library, t.parentCode),
  ],
);
