# Dice Fitness Mini App

The group has one editable leaderboard with **Open dice rolls**. Player selection, two-stage dice rolls, owed lists, completion, all-time totals and history live inside the app. Individual assignment records and all existing totals are preserved.

## Flow

Choose a player, optionally apply injury filters, roll an activity, then roll its reps/time. Each eligible activity has equal odds. The D20 is a Three.js (MIT) animation of the server's saved choice; repeated labels on its 20 visual faces do not change those odds. The second die uses the original six-face option mapping.

An unfinished roll resumes after reload; its activity and player stay locked until the amount is rolled. Repeated finalization requests return the same assignment. Injury choices belong only to that roll, reset for the next one, and are never saved to a player's profile. The filter sheet shows exactly which activities are excluded. These are movement exclusions, not a medical assessment.

**Tick 1 off** completes the explicitly displayed oldest owed item. Retrying it cannot complete the next one. **Mark all done** confirms the displayed snapshot; newly rolled exercises are not accidentally included. **History** can undo only the operator's explicitly displayed latest roll, preserving an audit record.

## Telegram and hosting setup

1. Route an HTTPS domain to the Compose `bot` service's port `3000`. Set `MINI_APP_URL` to that domain.
2. In [@BotFather](https://t.me/BotFather), select the bot → **Bot Settings → Configure Mini App → Enable Mini App**, then set the Main Mini App URL to `MINI_APP_URL`. Telegram requires this owner setting for `https://t.me/<bot>?startapp=rolls` group launchers; a bot API token cannot set it.
3. Set `MINI_APP_ENABLED=true` and deploy. Startup creates a replacement leaderboard that removes the old reply keyboard and attaches the app launcher. It removes only tracked obsolete bot leaderboard, control and daily-board messages, where Telegram permits deletion. Exercise records are untouched.

Leave `MINI_APP_ENABLED=false` until BotFather is configured. This keeps existing group controls operational while the website is deployed. With `MINI_APP_URL` set, `/start` in a private bot chat also offers a proper authenticated Mini App button.

New environment settings:

| Variable | Purpose |
|---|---|
| `MINI_APP_URL` | Public HTTPS Mini App address |
| `MINI_APP_ENABLED` | Switch the group to a single leaderboard and app launcher |
| `BOT_USERNAME` | Direct-launch username, default `dicefitnessbot` |
| `PORT` | HTTP port, 3000 in Compose |

## Security and recovery

Every API request checks the original signed Telegram `initData`, its age, group membership, and active-player status. No browser-supplied user identity, option amount or random outcome is trusted. Targets belong to the configured group. Bodies are bounded, responses use no-store, and per-user request limits apply.

The `app_rolls` table saves each pending choice and roll-specific injury filters. Transactions, advisory locks and a unique unfinished roll per operator prevent duplicate assignments and concurrent completion races. The original assignments/completion-batch tables still hold all history. Telegram projections edit the same leaderboard, ignore unchanged-content errors, serialize updates, and retry failed edits every 30 seconds. A failed projection does not invalidate a saved roll.

Keep one long-polling bot replica. Migrations run before HTTP/polling startup. Docker checks `/health`.

## Development and verification

```sh
npm install
npm run build
npm run test
npm run dev:app
```

Visit `http://127.0.0.1:5173/?demo=1` for an isolated sample UI. It uses sample players in browser memory and never calls the live game API. Actual game data requires a signed Telegram launch.

Integration tests require a disposable localhost database named `dice_test`. **They clear that test database's game tables before running.** Remote hosts and other database names are refused.

```sh
TEST_DATABASE_URL=postgres://postgres:local-test-password@127.0.0.1:55439/dice_test npm test
```

Tests cover Telegram signature tampering/expiry, injury unions, unfinished-roll recovery, concurrent retries, oldest-item completion, undo scope, membership and projection refresh ordering.

`node dist/scripts/mini-app-status.js` prints non-secret deployment mode and player/assignment counts. The guarded group-migration utility now also moves pending app rolls if Telegram upgrades the group's ID again.
