import type { Api } from "grammy";
import type { BotCommandScope } from "grammy/types";

export const groupCommandScopes = (chatId: number): BotCommandScope[] => [
  { type: "default" }, { type: "all_group_chats" }, { type: "all_chat_administrators" },
  { type: "chat", chat_id: chatId }, { type: "chat_administrators", chat_id: chatId },
];

export async function configureMiniAppCommands(api: Pick<Api, "setMyCommands" | "deleteMyCommands">, chatId: number) {
  // Delete inherited menus too: deleting just the chat list exposes higher scopes.
  // Private-chat onboarding remains available without advertising group commands.
  await api.setMyCommands([{ command: "start", description: "Open Dice Fitness" }], { scope: { type: "all_private_chats" } });
  for (const scope of groupCommandScopes(chatId)) for (const language_code of [undefined, "en"] as const) await api.deleteMyCommands({ scope, language_code });
}
