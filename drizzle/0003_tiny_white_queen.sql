ALTER TABLE "consent_records" ADD COLUMN "subject_encrypted" text NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_records" ADD COLUMN "purpose" varchar(30) NOT NULL;