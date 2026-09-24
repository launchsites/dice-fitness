# Exercise Dice Bot

A private Telegram group game: choose a player in your own private-in-the-group controller, roll a real Telegram 🎲, and assign the exercise that face determines. Assignments stay separate and in order; they are not merged into workout totals.

## What it does

- Uses Telegram's animated dice as the source of truth for each amount.
- Keeps a persistent per-operator selected target, player registrations, immutable assignment audit history, soft undo, and completion batches.
- Creates one editable daily board only once the first roll happens that London calendar day.
- Keeps one editable, pin-friendly all-time leaderboard based on completed (not merely assigned) exercises.
- Uses PostgreSQL plus Drizzle migrations. Telegram messages are rebuildable database projections.

## Setup

1. In Telegram, open [@BotFather](https://t.me/BotFather), create a bot, and copy its token.
2. Add the bot to the game group. Make it an admin if you want it to pin the leaderboard; it also needs normal message permissions to post/edit game messages.
3. Discover the numeric group chat ID (for example by temporarily logging `ctx.chat.id`, or using a trusted ID bot), then copy the example environment file:

   ```sh
   cp .env.example .env
   ```

4. Set `BOT_TOKEN`, `GAME_CHAT_ID`, and a strong `SERVICE_PASSWORD_64_POSTGRES` in `.env`. For local Compose, `DATABASE_URL` may retain its `postgres` hostname.
5. Start the stack:

   ```sh
   docker compose up --build -d
   docker compose logs -f bot
   ```

6. In the group, each player opens Telegram's bot command picker beside the message field and chooses **Open my private game controller**. The private `/controller` command registers them on first use and opens their controller; no DM or administrator action is required. An administrator can still use `/addplayer` by replying to someone as an optional fallback.

## Game flow

The private-in-the-group controller remembers who each operator selected. **ROLL** picks an exercise uniformly, posts the exercise name in the group, sends Telegram's native 🎲, waits for its animation, then stores the amount dictated by that real dice face.

Use **VIEW OWED** to see every outstanding event in order. **IS CAUGHT UP** marks only that target's currently outstanding records as complete in a completion batch; later rolls remain owed. **UNDO LAST ROLL** only affects the most recent non-undone roll made by the person pressing it, preserving an audit record and correcting completed totals if necessary.

## Group commands

- `/controller` — private, one-tap controller in Telegram's bot command picker; also registers a new player.
- `/addplayer` — administrator-only fallback; reply to a person's message.
- `/removeplayer` — administrator only; reply to a player's message. Keeps history, makes them inactive.
- `/players` — list active players.
- `/refresh` — administrator only; reconstructs leaderboard and current daily board from PostgreSQL.
- `/leaderboard` and `/today` — refresh those projections.

The bot ignores group commands outside `GAME_CHAT_ID`; its group controller and the optional DM fallback require an active player registration.

## Coolify deployment

Create a new **Docker Compose** application from this repository. Coolify will generate the PostgreSQL password declared as `SERVICE_PASSWORD_64_POSTGRES`; set only `BOT_TOKEN`, `GAME_CHAT_ID`, `TZ=Europe/London`, and optional `LOG_LEVEL=info` in Coolify. Long polling means no public webhook/domain is needed. Keep exactly one bot replica running, because Telegram permits only one active long-polling consumer per bot token.

Migrations run before polling starts. PostgreSQL must have persistent storage; the included `postgres_data` volume provides that locally.

## Development and verification

```sh
npm install
npm run test
npm run build
```

The tests cover the paired three-value dice mapping, face-by-face walking-lunge mapping, and non-aggregated daily ordering. The service layer uses transactions for completion batches and per-user in-process rolling locks; persisted assignment state remains authoritative across restarts.
