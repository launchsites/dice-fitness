ALTER TABLE "assignments" ALTER COLUMN "dice_result" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "entry_type" text DEFAULT 'roll' NOT NULL;
--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "entry_request_id" uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_entry_request_unique" ON "assignments" ("entry_request_id");
--> statement-breakpoint
ALTER TABLE "app_rolls" ADD COLUMN "exercise_exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL;
