CREATE TYPE "public"."processing_status" AS ENUM('queued', 'processing', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."upload_form" AS ENUM('fpe', 'consultation', 'diagnostic_request', 'diagnostic_results', 'medicine', 'referral');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'staff');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"facility_id" uuid,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"request_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"patient_pin_hmac" char(64) NOT NULL,
	"patient_pin_encrypted" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"form" "upload_form" NOT NULL,
	"patient_pin_hmac" char(64),
	"payload_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accre_no" varchar(9) NOT NULL,
	"name" varchar(200) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facilities_accre_no_unique" UNIQUE("accre_no")
);
--> statement-breakpoint
CREATE TABLE "record_counters" (
	"facility_id" uuid NOT NULL,
	"prefix" char(1) NOT NULL,
	"counter_date" date NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "record_counters_facility_id_prefix_counter_date_pk" PRIMARY KEY("facility_id","prefix","counter_date")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" char(64) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"form" "upload_form" NOT NULL,
	"upload_transaction_no" varchar(23),
	"processing_status" "processing_status" DEFAULT 'queued' NOT NULL,
	"record_numbers" jsonb NOT NULL,
	"payload_encrypted" text NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"request_id" uuid,
	"received_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"poll_attempts" integer DEFAULT 0 NOT NULL,
	"next_poll_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_upload_transaction_no_unique" UNIQUE("upload_transaction_no")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"username" varchar(150) NOT NULL,
	"display_name" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_facility_username" UNIQUE("facility_id","username")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_counters" ADD CONSTRAINT "record_counters_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_facility_created" ON "audit_log" USING btree ("facility_id","created_at");--> statement-breakpoint
CREATE INDEX "consent_facility_pin" ON "consent_records" USING btree ("facility_id","patient_pin_hmac");--> statement-breakpoint
CREATE INDEX "drafts_facility_form" ON "drafts" USING btree ("facility_id","form");--> statement-breakpoint
CREATE INDEX "submissions_status_poll" ON "submissions" USING btree ("processing_status","next_poll_at");--> statement-breakpoint
CREATE INDEX "submissions_facility_form" ON "submissions" USING btree ("facility_id","form");