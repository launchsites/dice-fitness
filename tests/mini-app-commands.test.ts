import { expect, it, vi } from "vitest";
import { configureMiniAppCommands, groupCommandScopes } from "../src/bot/commands.js";

it("clears group and inherited command menus, including English overrides, but retains private onboarding", async () => {
  const api = { setMyCommands: vi.fn().mockResolvedValue(true), deleteMyCommands: vi.fn().mockResolvedValue(true) };
  await configureMiniAppCommands(api, -123456);
  expect(api.setMyCommands).toHaveBeenCalledWith([{ command: "start", description: "Open Dice Fitness" }], { scope: { type: "all_private_chats" } });
  for (const scope of groupCommandScopes(-123456)) for (const language_code of [undefined, "en"]) expect(api.deleteMyCommands).toHaveBeenCalledWith({ scope, language_code });
  expect(api.deleteMyCommands).toHaveBeenCalledTimes(10);
});
