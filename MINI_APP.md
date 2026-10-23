# Dice Fitness Mini App

The group has one editable leaderboard with **Open dice rolls**. The app has only **Roll** and **Owed**, in a dark Telegram-style UI. Individual assignment records and all existing totals are preserved; the leaderboard and totals stay in the chat.

## Flow

The Roll screen fits the viewport without page scrolling: player, injury control, white labelled dice, and a large blue Roll button. Choose a player, optionally apply injury filters, roll an activity, then roll its reps/time. Each eligible activity has equal odds. The activity die has exactly one labelled outcome face per eligible exercise, rebuilding its shape when filters change rather than repeating labels on a fixed D20. Two choices use a coin; three use the three labelled sides of a triangular prism with structural endcaps. With no eligible activities, there is no die and rolling stays disabled. Three.js (MIT) animates the server's saved choice; different face areas never change server-side odds. The amount die retains the original six-face option mapping.

An unfinished roll resumes after reload; its activity and player stay locked until the amount is rolled. Repeated finalization requests return the same assignment. Injury choices belong only to that roll, reset for the next one, and are never saved to a player's profile. The compact injury sheet describes excluded movements. These are movement exclusions, not a medical assessment.

**Owed** shows each player's individual exercises. The tick beside an exercise completes only that exact assignment, in any order. The undo arrow opens a confirmation to dismiss that exact owed roll without completion credit. Any active group member can dismiss an owed item; completed exercises cannot be dismissed. Dismissal is soft undo with the acting player's ID and timestamp, not deletion. Both actions are retry-safe and serialize against each other. Long lists scroll inside the Owed screen while the two-tab navigation remains visible, and completing or dismissing an item preserves the list position. Entering Owed or tapping its refresh button fetches the latest state. There is no bulk-complete, history or leaderboard screen in the app; underlying audit history and legacy chat operations remain intact.

Dice use Three.js rounded/chamfered geometry, physical white materials, a subtle procedural surface texture, room reflections and feathered contact shadows. Motion eases through a tumble, bounce and settle; reduced-motion users receive a short transition. Ordinary busy states retain the renderer rather than resetting it, and animation pauses while the app is hidden.

Before either roll, drag the dice (or focus it and use arrow keys) to inspect its faces. This changes only presentation: it creates no game requests and cannot choose an outcome. A swipe carries angular momentum after release, with frame-rate-independent exponential drag; as it slows, it blends into idle movement from the inspected orientation without an extra pause. Touching the die catches it immediately. Holding still before release does not reuse old swipe velocity. Keyboard/direct inspection without a flick retains the two-second idle pause. Inspection and momentum lock during requests/rolling and on the saved result. Reduced-motion mode still permits direct inspection, but suppresses inertial and idle animation.

Rendering targets the display's native density, up to 4x within a 1.8-million-pixel budget. Retina face textures are 1024px with anisotropic filtering, and duplicate activity labels share materials. Devices advertising low memory or data-saving mode use a smaller budget, 2x cap and 512px textures. After warm-up, sustained slow frames reduce the resolution ceiling; isolated stalls do not. These are conservative runtime limits, not a guarantee of device-specific performance.

Layout adds device safe-area and Telegram content-safe-area insets. It observes safe-area, fullscreen and viewport events, including late native updates, and preserves browser notch-inset fallbacks. Headers, controls and sheets remain below Telegram chrome. The stable viewport height keeps the roll action and navigation on-screen.

## Telegram and hosting setup

1. Route an HTTPS domain to the Compose `bot` service's port `3000`. Set `MINI_APP_URL` to that domain.
2. In [@BotFather](https://t.me/BotFather), select the bot → **Bot Settings → Configure Mini App → Enable Mini App**, then set the Main Mini App URL to `MINI_APP_URL`. Telegram requires this owner setting for `https://t.me/<bot>?startapp=rolls` group launchers; a bot API token cannot set it.
3. Set `MINI_APP_ENABLED=true` and deploy. Startup creates a replacement leaderboard that removes the old reply keyboard and attaches the app launcher. It removes only tracked obsolete bot leaderboard, control and daily-board messages, where Telegram permits deletion. Exercise records are untouched.

Leave `MINI_APP_ENABLED=false` until BotFather is configured. This keeps existing group controls operational while the website is deployed. With `MINI_APP_URL` set, `/start` in a private bot chat also offers a proper authenticated Mini App button.

Mini App mode removes the group command menu, including inherited default/group/admin lists and English overrides. Private-chat `/start` remains advertised; manual administrator recovery/setup handlers remain available without appearing as group menu commands. Telegram clients may need the group reopened to refresh cached suggestions.

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

Tests cover Telegram signature tampering/expiry, injury unions, unfinished-roll recovery, concurrent retries, oldest-item and individually selected completion, undo scope, membership and projection refresh ordering. Individual completion and owed dismissal are tested through HTTP, including retries, preservation of unrelated rows, audit fields, rejection of completed/foreign-group rows and dismissal/completion races. Safe-area unit tests cover additive insets, fullscreen fallback, landscape cutouts and invalid values.

`node dist/scripts/mini-app-status.js` prints non-secret deployment mode and player/assignment counts. The guarded group-migration utility now also moves pending app rolls if Telegram upgrades the group's ID again.
