CREATE TABLE "external_codes" (
	"library" varchar(50) NOT NULL,
	"code" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"parent_code" varchar(20),
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "external_codes_library_code_pk" PRIMARY KEY("library","code")
);
--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "cipher_key_encrypted" text;--> statement-breakpoint
CREATE INDEX "external_codes_library_parent" ON "external_codes" USING btree ("library","parent_code");