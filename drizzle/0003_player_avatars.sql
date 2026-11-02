CREATE TABLE "player_avatars" (
  "group_id" bigint NOT NULL REFERENCES "groups"("id"),
  "player_id" integer NOT NULL REFERENCES "players"("id"),
  "image" bytea NOT NULL CHECK (octet_length("image") BETWEEN 1 AND 1048576),
  "mime" text NOT NULL CHECK ("mime" IN ('image/jpeg', 'image/png', 'image/webp')),
  "updated_by_player_id" integer NOT NULL REFERENCES "players"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "player_avatars_group_player_unique" ON "player_avatars" ("group_id", "player_id");
