import type { Api } from "grammy";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { groupPlayers, playerAvatars, players } from "../db/schema.js";
import { env } from "../config/env.js";
import { AppError } from "../web/errors.js";
import { getPlayer } from "./game-service.js";

export type Avatar = { image: Buffer; mime: string };
const maxBytes = 1024 * 1024;
// grammY declares its older AbortSignal shim; Node's signal has the same runtime cancellation API.
const telegramTimeout = () => AbortSignal.timeout(3000) as unknown as NonNullable<Parameters<Api["getFile"]>[1]>;
export function avatarImage(image: Buffer): Avatar {
  if (!image.length || image.length > maxBytes) throw new AppError(400, "Use a profile image smaller than 1 MB.");
  const mime = image.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
    : image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  if (!mime) throw new AppError(400, "Use a JPEG, PNG or WebP profile image.");
  return { image, mime };
}

/** Fetches through the backend so token-bearing Telegram file URLs never reach clients. */
export function avatarReader(api: Api, download: typeof fetch = fetch) {
  const cache = new Map<number, { avatar: Avatar | null; expires: number }>();
  const pending = new Map<number, Promise<Avatar | null>>();
  async function telegramPhoto(userId: number) {
    try {
      const photos = await api.getUserProfilePhotos(userId, { limit: 1 }, telegramTimeout());
      const photo = photos.photos[0]?.[0];
      if (!photo) return null;
      const file = await api.getFile(photo.file_id, telegramTimeout());
      if (!file.file_path || file.file_path.includes("..") || !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) || (file.file_size ?? 0) > maxBytes) return null;
      const response = await download(`https://api.telegram.org/file/bot${env.botToken}/${file.file_path}`, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok || Number(response.headers.get("content-length") ?? 0) > maxBytes || !response.body) { await response.body?.cancel(); return null; }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > maxBytes) { await reader.cancel(); return null; } chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      return avatarImage(Buffer.concat(chunks));
    } catch { return null; } // Missing/private photos and upstream failures use initials; never log download URLs.
  }
  return async (playerId: number): Promise<Avatar | null> => {
    const [player] = await db.select({ userId: players.telegramUserId }).from(players).innerJoin(groupPlayers, eq(groupPlayers.playerId, players.id)).where(and(eq(groupPlayers.groupId, env.gameChatId), eq(players.id, playerId)));
    if (!player) throw new AppError(404, "Player not found.");
    // Overrides are checked before the Telegram cache, so admin changes apply immediately.
    const [override] = await db.select().from(playerAvatars).where(and(eq(playerAvatars.groupId, env.gameChatId), eq(playerAvatars.playerId, playerId)));
    if (override) return { image: override.image, mime: override.mime };
    const old = cache.get(playerId); if (old && old.expires > Date.now()) return old.avatar;
    let request = pending.get(playerId);
    if (!request) {
      request = telegramPhoto(player.userId).then((avatar) => {
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(playerId, { avatar, expires: Date.now() + (avatar ? 3_600_000 : 60_000) });
        return avatar;
      }).finally(() => pending.delete(playerId));
      pending.set(playerId, request);
    }
    return request;
  };
}

/** CLI-only override management; the acting player must be a current group admin. */
export async function setPlayerAvatar(api: Api, targetTelegramId: number, operatorTelegramId: number, image: Buffer | null) {
  const member = await api.getChatMember(env.gameChatId, operatorTelegramId);
  if (member.status !== "administrator" && member.status !== "creator") throw new AppError(403, "Only a group admin can set profile overrides.");
  const [target, operator] = await Promise.all([getPlayer(env.gameChatId, targetTelegramId), getPlayer(env.gameChatId, operatorTelegramId)]);
  if (!target || !operator?.active) throw new AppError(404, "Choose players from this game.");
  if (image) {
    const avatar = avatarImage(image);
    await db.insert(playerAvatars).values({ groupId: env.gameChatId, playerId: target.id, ...avatar, updatedByPlayerId: operator.id }).onConflictDoUpdate({ target: [playerAvatars.groupId, playerAvatars.playerId], set: { ...avatar, updatedByPlayerId: operator.id, updatedAt: new Date() } });
  } else await db.delete(playerAvatars).where(and(eq(playerAvatars.groupId, env.gameChatId), eq(playerAvatars.playerId, target.id)));
  return { player: target.displayName, override: !!image };
}
