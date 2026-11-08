CREATE TABLE "patient_cases" (
	"facility_id" uuid NOT NULL,
	"patient_pin_hmac" char(64) NOT NULL,
	"case_no" varchar(23) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_cases_facility_id_patient_pin_hmac_pk" PRIMARY KEY("facility_id","patient_pin_hmac")
);
--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "record_key" varchar(200) NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patient_cases" ADD CONSTRAINT "patient_cases_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;