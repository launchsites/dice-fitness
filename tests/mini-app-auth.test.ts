import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyInitData } from "../src/web/auth.js";

const token = "123456:test-token";
const now = 1_790_000_000_000;
function signed(fields: Record<string, string>) {
  const data = Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return new URLSearchParams({ ...fields, hash: createHmac("sha256", secret).update(data).digest("hex") }).toString();
}
const fields = { auth_date: String(now / 1000), user: JSON.stringify({ id: 1234, first_name: "Jamie" }), query_id: "test-query" };

describe("Telegram Mini App authentication", () => {
  it("accepts the signed Telegram identity", () => { expect(verifyInitData(signed(fields), token, now).id).toBe(1234); });
  it("rejects user tampering, unsigned requests, and a different bot token", () => {
    expect(() => verifyInitData(signed(fields).replace("Jamie", "Greg"), token, now)).toThrow();
    expect(() => verifyInitData(new URLSearchParams(fields).toString(), token, now)).toThrow();
    expect(() => verifyInitData(signed(fields), "another-token", now)).toThrow();
  });
  it("rejects expired sessions, future dates, and duplicated query fields", () => {
    expect(() => verifyInitData(signed({ ...fields, auth_date: String(now / 1000 - 86401) }), token, now)).toThrow("expired");
    expect(() => verifyInitData(signed({ ...fields, auth_date: String(now / 1000 + 60) }), token, now)).toThrow("expired");
    expect(() => verifyInitData(signed(fields) + "&user=another", token, now)).toThrow();
  });
});
