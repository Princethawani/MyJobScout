CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" varchar(40) DEFAULT 'found' NOT NULL,
	"letter" text,
	"letter_version" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"document_type" varchar(80) NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" varchar(120),
	"default_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"source_job_id" varchar(255),
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" text,
	"location" text,
	"description" text,
	"contact_email" varchar(320),
	"employment_type" varchar(80),
	"salary" text,
	"deadline" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"fit_score" real,
	"score_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"base_url" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "applications_job_unique" ON "applications" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_url_unique" ON "jobs" USING btree ("source_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_name_unique" ON "sources" USING btree ("name");