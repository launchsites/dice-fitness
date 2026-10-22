CREATE TABLE "app_rolls" (
  "id" uuid PRIMARY KEY NOT NULL,
  "group_id" bigint NOT NULL REFERENCES "groups"("id"),
  "operator_player_id" integer NOT NULL REFERENCES "players"("id"),
  "target_player_id" integer NOT NULL REFERENCES "players"("id"),
  "exercise_key" text NOT NULL,
  "injury_filters" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "assignment_id" integer REFERENCES "assignments"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "app_rolls_one_pending_per_operator" ON "app_rolls" ("group_id", "operator_player_id") WHERE "assignment_id" IS NULL;
