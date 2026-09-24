import { bigint, boolean, date, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const joinedAt = timestamp("joined_at", { withTimezone: true }).notNull().defaultNow();
const completedAt = timestamp("completed_at", { withTimezone: true }).notNull().defaultNow();

export const groups = pgTable("groups", { id: bigint("id", { mode: "number" }).primaryKey(), createdAt });
export const players = pgTable("players", {
  id: serial("id").primaryKey(), telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull().unique(),
  displayName: text("display_name").notNull(), username: text("username"), joinedAt,
});
export const groupPlayers = pgTable("group_players", {
  id: serial("id").primaryKey(), groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id),
  playerId: integer("player_id").notNull().references(() => players.id), active: boolean("active").notNull().default(true), joinedAt,
}, (table) => [uniqueIndex("group_players_group_player_unique").on(table.groupId, table.playerId)]);
export const operatorPreferences = pgTable("operator_preferences", {
  groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id),
  operatorPlayerId: integer("operator_player_id").notNull().references(() => players.id),
  selectedTargetPlayerId: integer("selected_target_player_id").notNull().references(() => players.id), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("operator_preferences_unique").on(table.groupId, table.operatorPlayerId)]);
export const completionBatches = pgTable("completion_batches", {
  id: serial("id").primaryKey(), groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id),
  targetPlayerId: integer("target_player_id").notNull().references(() => players.id), completedAt,
});
export const assignments = pgTable("assignments", {
  id: serial("id").primaryKey(), groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id),
  targetPlayerId: integer("target_player_id").notNull().references(() => players.id), operatorPlayerId: integer("operator_player_id").notNull().references(() => players.id),
  exerciseKey: text("exercise_key").notNull(), measurement: text("measurement", { enum: ["reps", "seconds"] }).notNull(), amount: integer("amount").notNull(), diceResult: integer("dice_result").notNull(),
  gameDate: date("game_date").notNull(), assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }), completionBatchId: integer("completion_batch_id").references(() => completionBatches.id), undoneAt: timestamp("undone_at", { withTimezone: true }), undoneByPlayerId: integer("undone_by_player_id").references(() => players.id),
});
export const dailyBoards = pgTable("daily_boards", {
  id: serial("id").primaryKey(), groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id), gameDate: date("game_date").notNull(), telegramMessageId: integer("telegram_message_id"), createdAt,
}, (table) => [uniqueIndex("daily_boards_group_date_unique").on(table.groupId, table.gameDate)]);
export const botMessages = pgTable("bot_messages", {
  groupId: bigint("group_id", { mode: "number" }).notNull().references(() => groups.id), key: text("key").notNull(), telegramMessageId: integer("telegram_message_id"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("bot_messages_group_key_unique").on(table.groupId, table.key)]);
