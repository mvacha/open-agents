ALTER TABLE "sessions" ADD COLUMN "repo_provider" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "repo_meta" jsonb;