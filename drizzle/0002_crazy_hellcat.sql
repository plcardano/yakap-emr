CREATE TYPE "public"."verification_mode" AS ENUM('PCU', 'OTP', 'VALID_ID');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'submitted', 'verified', 'failed', 'captured', 'error');--> statement-breakpoint
CREATE TABLE "patient_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"facility_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"mode" "verification_mode" NOT NULL,
	"status" "verification_status" NOT NULL,
	"patient_pin_hmac" char(64),
	"verification_date" date NOT NULL,
	"liveness_authorization_id" varchar(100),
	"result_code" varchar(10),
	"pcu_trans_no" varchar(20),
	"one_time_pin_encrypted" text,
	"valid_id_type" varchar(2),
	"valid_id_image_encrypted" text,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_verifications_liveness_authorization_id_unique" UNIQUE("liveness_authorization_id")
);
--> statement-breakpoint
ALTER TABLE "consent_records" ALTER COLUMN "patient_pin_hmac" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_verifications" ADD CONSTRAINT "patient_verifications_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_verifications" ADD CONSTRAINT "patient_verifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verifications_lookup" ON "patient_verifications" USING btree ("facility_id","patient_pin_hmac","verification_date");--> statement-breakpoint
ALTER TABLE "consent_records" DROP COLUMN "patient_pin_encrypted";