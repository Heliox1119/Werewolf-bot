# Changelog

All notable changes to this project are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

---

## [3.5.2] - 2026-03-02

### Changed
- **DAY_DELIBERATION phase removed** — Debate and vote merged into a single DAY_VOTE phase (8 min)
- Votes can be changed until the timer expires
- Early resolution triggers on absolute majority or when all alive players have voted
- `hasAbsoluteMajority()` added to vote engine (threshold: ⌊n/2⌋+1)
- `startDayTimeout()` simplified — single timer, no type parameter

### Changed
- **GUI_MASTER architecture** — All game state displayed via persistent editable embeds (one per channel), zero narrative `channel.send()` calls
- Village master panel, role panels, spectator panel all managed as edit-only
- `ALLOWED_SEND_TYPES` whitelist enforces which events may produce channel messages
- Debug role GUI pipeline: select menu for role assignment in debug commands

### Changed
- **Captain election select menu** — Captain vote uses `StringSelectMenuBuilder` instead of slash command, with player list dropdown

### Changed
- **Logger refactored** — Per-module structured logger (`createModuleLogger(module)`) with contextual prefix, `LOG_LEVEL` env var, timer API

### Fixed
- Error 10008 on cleanup button (message already deleted)
- SyntaxError brace mismatch in `index.js` (`runWithContext` wrapper)

---

## [3.5.1] - 2026-03-01

### Added
- **Full reboot state persistence** — `hunter_must_shoot_id`, `captain_tiebreak_ids` (JSON), `no_kill_cycles`, `idiot_revealed` flag all persisted and restored
- Wolf/captain votes saved to `votes` table, conditionally restored based on phase/subPhase on recovery
- Re-arm all 5 timer types on restart with elapsed-time offset

### Fixed
- **AFK infinite loop** — `MAX_NO_KILL_CYCLES: 3` forces a draw after 3 consecutive no-kill nights
- **Vote during captain election** — `subPhase !== PHASES.VOTE` guard in `/vote` prevents village votes during `VOTE_CAPITAINE`

### Changed
- 4 new DB columns: `hunter_must_shoot_id`, `captain_tiebreak_ids`, `no_kill_cycles`, `idiot_revealed`

---

## [3.5.0] - 2026-02-28

### Changed
- **i18n engine rewrite** — Extracted 1491 translation keys from inline JS into external JSON: `web/public/locales/fr.json` and `web/public/locales/en.json`
- `webI18n.js` rewritten as pure fetch-based engine (3517 → 227 lines), caches after first load
- 100% FR/EN parity — 9 missing FR keys added

### Added
- **SQLite session store** — Replaced in-memory `MemoryStore` with `better-sqlite3-session-store`
- Auto-generated session secret persisted to `data/.session-secret`
- Expired session cleanup every 15 minutes, WAL mode enabled

---

## [3.4.1] - 2026-02-26

### Added
- **Composable ability engine** — New `game/abilities/` module for custom role definitions
  - JSON schema validation, built-in role configs for all 12 roles, conflict resolver, effect handlers, event bus, role builder service
- **Dashboard data panels** — Global leaderboard (top 5) and recent completed games (last 5)
- **Invite card deck** — Premium role card mini-game with shuffle, deal, and flip animations
- **Player page redesign** — Discord avatar integration, achievement progress bars, ELO tier display
- **Spectator UX** — Profile popup on player click, event feed persistence, vote chart fixes

### Changed
- **Global ambient lighting** — Replaced 11 per-page orb systems with single `body::before` glow layer
- Darkened color palette for proper luminance hierarchy
- Page transitions simplified to opacity-only animations
- Roles encyclopedia, premium page, and support page fully redesigned

---

## [3.4.0] - 2026-02-25

### Added
- **PJAX navigation** — SPA-like page transitions with AJAX content swap, CSS animations, browser history
- **Discord-style dual sidebar** — Guild icon bar + guild management panel
- **Dashboard command center** — Hero with animated KPIs, "Draw a Role" card game, activity feed, live game grid
- **Guild overview** — Win distribution charts, top players, recent games, animated metrics
- **Leaderboard podium** — Top 3 visual cards with gold/silver/bronze glow
- **Documentation wiki** — Full in-app wiki with sticky sidebar navigation
- **Invite landing page** — Feature showcase, role carousel, permissions section, scroll-reveal
- **Live spectator redesign** — 3-column layout with player modal, vote chart, real-time feed
- **Monitoring enhancements** — Access-level filtering, health ring, sparkline charts
- **`/setup wizard`** — Interactive buttons UI (Auto Setup, Choose Category, Cancel)

### Changed
- `/create` now requires prior `/setup wizard` — no fallback to first category
- Bot retains `ViewChannel + ManageChannels` on all hidden game channels (fixes multi-guild cleanup)

### Added
- **Guild reconciliation** — Auto-purge stale guild data on startup when bot leaves a server
- `player_guilds` junction table, `custom_roles` table, config guild isolation fix

---

## [3.3.0] - 2026-02-24

### Added
- **Crash simulation matrix** — Automated restart verification at 5 critical failure points
- **GameMutex observability** — Acquisition wait/hold tracking, queue length, `max_wait_ms`/`avg_wait_ms`/`active_locks` metrics
- **Startup lock** — File-based inter-process boot lock prevents multi-instance startup
- **WebSocket abuse resistance** — Server-side guild authorization, unauthorized subscription blocking, guild-scoped throttled broadcasts
- **Liveness monitoring** — Per-game `_lastMutationAt` tracking, STUCK detection, `stuck_games_count` metric

---

## [3.2.0] - 2026-02-24

### Added
- **GameMutex** — Async promise-chaining lock per game, replaces `_transitioning` boolean
- **FSM transition table** — `VALID_TRANSITIONS` map, `isValidTransition()`, `_setSubPhase()` single entry point
- **Transaction-wrapped DB sync** — `syncGameToDb()` runs inside `db.transaction()`, atomic writes
- **Dirty flag** — `dirtyGames` Set, `saveState()` only syncs changed games
- **Deduplication** — `isRecentDuplicate` on 12 commands (vote, kill, see, potion, protect, shoot, love, join, start, captainvote, skip, nextphase)
- **API rate limiting** — `express-rate-limit` (60 req/min API, 15 req/min mod)
- **CORS configurable** — `CORS_ORIGINS` env var for Express and Socket.IO
- **Prometheus metrics** — `/api/metrics` endpoint, `/api/health` for load balancer probes
- **Guild-scoped WebSocket rooms** — Clients join their guild room with snowflake validation
- **Pagination** — `/api/history` and `/api/leaderboard` support `offset` parameter

### Changed
- 7 new DB columns persisted: `white_wolf_channel_id`, `protected_player_id`, `last_protected_player_id`, `village_roles_powerless`, `listen_hints_given`, `thief_extra_roles`, `white_wolf_kill_target_id`
- Timer re-arm on boot for in-progress games

---

## [3.1.0] - 2026-02-24

### Fixed
- **CRITICAL**: `start()` now clears lobby timeout — previously, active games could be deleted mid-game by the 1h cleanup timer
- **CRITICAL**: `nextPhase()` guards against ENDED games — no more toggling back to NIGHT

### Added
- XSS elimination — all `innerHTML` with user data replaced by safe DOM API
- WebSocket rate limiting (30 events/10s/socket), input validation, scoped `globalEvent`
- `requestGames` filtered by user's guilds, leaderboard guild-filtered
- `t()` accepts `guildId` for per-server language resolution
- Game archiving — `archiveOldGames()` cleans ended games older than 7 days
- DB indexes on `games(guild_id)`, `games(guild_id, ended_at)`, `player_stats(username)`

---

## [3.0.0] - 2026-02-24

### Added
- **Web Dashboard** — Express.js server with Discord OAuth2, dark theme, multiple pages (dashboard, guild, player, roles, spectator, login)
- **Live Spectator** — Socket.IO real-time game watching with event feed, player panel, spectator rooms
- **REST API** — 12 endpoints: games, leaderboard, players, history, stats, guilds, roles (CRUD), config (CRUD)
- **Custom Roles** — `custom_roles` table, CRUD API, visual editor page
- **GameManager EventEmitter** — 7 event types bridging game engine to web layer
- **`getGameSnapshot()`** — Sanitized serializable game state for web display

---

## [2.9.0] - 2026-02-23

### Added
- **18 achievements** — 6 categories (victory, wolf, village, special, social, general), tracking in-game, post-game announcements
- **ELO ranking system** — Dynamic calculation with adaptive K-factor, 7 tiers (Iron → Alpha Wolf)
- **Death reveal embeds** — Themed embeds on death with role, cause, and color coding
- **DM turn notifications** — Automatic DM when it's a role's turn at night
- **`/leaderboard`**, **`/history`** commands, **`/stats`** enriched with ELO and achievements
- **Post-game timeline** — Chronological event summary with ELO changes

### Fixed
- `isInGameCategory()` now passes `guildId` (multi-guild support)
- `advanceSubPhase()` uses `announceVictoryIfAny()` instead of broken inline logic
- `listen.js` `logAction()` correct format
- `villageRolesPowerless` and `ancienExtraLife` restored on reboot

---

## [2.8.0] - 2026-02-23

### Added
- **Docker** — Multi-stage Dockerfile (Node 20 Alpine), docker-compose with persistent volumes, health check
- **Auto backup** — Hourly SQLite backup with 24h rotation, backup on shutdown, manual `npm run backup`
- **Multi-guild** — Per-server language, config, category with global fallback
- **Rematch system** — "🔄 Rematch" button in post-game summary, auto-joins previous players

---

## [2.7.0] - 2026-02-19

### Added
- **Little Girl real-time spy** — `/listen` activates anonymous DM relay of wolf messages, auto-stops on phase transition
- **Smart hint system** — 30% detection chance per listen, `pickSmartHint()` gives most ambiguous letter, Unicode/zalgo normalized
- **Wolf win condition** — `/setrules wolfwin:majority|elimination`, persisted per-server, lobby toggle button
- **Guild-only commands** — Slash commands registered per-server when `GUILD_ID` is set

---

## [2.6.0] - 2026-02-19

### Changed
- **Phase timing rebalanced** — Night AFK: 120s, Hunter shoot: 90s, Day vote: 180s, Captain vote: 120s
- **Automatic captain vote** — Auto-resolves when all voted or on timeout, tie-breaking by random draw
- **Wolf count** — 1 wolf for ≤5 players, 2 wolves for 6+

### Removed
- `/declarecaptain` command — replaced by automatic resolution

### Fixed
- Witch life potion no longer kills the witch (`witchKillTarget` properly reset)

---

## [2.5.1] - 2025-02-15

### Fixed
- Category validation — `/create` verifies Discord category exists before creating channels
- Orphan cleanup no longer deletes Discord categories

---

## [2.5.0] - 2025-02-14

### Added
- **3 new roles** — Salvateur (`/protect`), Ancien (extra-life), Idiot du Village (survives vote, loses voting right)
- **Spectator mode** — `👻-spectateurs` channel, dead players get read-only access to all role channels
- **Embed themes** — 4 color palettes (Classic, Midnight, Nature, Blood Moon), `/theme` command, 12 semantic colors

---

## [2.4.0] - 2026-02-14

### Added
- **i18n system** — Centralized `I18n` singleton with `{{variable}}` interpolation, automatic fallback
- **`/lang`** command — Switch between FR/EN, persisted in database
- **500+ translation keys** across 22+ categories in `locales/fr.js` and `locales/en.js`

---

## [2.3.0] - 2026-02-12

### Fixed
- **32 bug fixes** (5 critical, 7 high, 12 medium, 8 low) — captain double-vote, wolf victory detection, channel permissions, couple duplicate, ghost voting, wolf consensus, witch double-poison, and more

### Added
- `/skip` command — Skip night actions (Seer, Witch, Cupid)
- `player_stats`, `night_actions`, `metrics` tables for persistent tracking
- Public vote announcements with counter (without revealing target)

---

## [2.2.1] - 2026-02-11

### Changed
- **Production hardening** — 26 fixes: env validation, graceful shutdown, `safeReply` everywhere, centralized logger, scoped cleanup, ephemeral role reveals, audio validation, permission checks
- `TIMEOUTS` constants replace all magic numbers
- `roleHelpers.js` factorizes role descriptions and images

### Added
- 114 new tests (77 → 191 total)

---

## [2.2.0] - 2026-02-11

### Added
- **`/shoot`** — Hunter shoots on death (auto-detection, 60s timeout)
- **`/vote-end`** — Majority vote to stop the game
- **AFK timeout** — 90s auto-advance for night roles, 60s for hunter
- **Transition lock** — `_transitioning` flag prevents double phase transitions

### Fixed
- 14 critical fixes: `command is not defined` crash, DB/memory desync, snowflake precision loss, button handling, sub-phase enforcement, dead player checks

---

## [2.0.0] - 2026-02-09

### Added
- Debounced saves (90% I/O reduction), Discord cache optimization, smart mute/unmute
- `validators.js` module, `commands.js` helpers (`checkCategoryAndDefer`, `safeReply`)
- `/force-end` admin command, `/debug-games` listing

### Changed
- 650 lines of duplicated code removed
- Health check script added

---

## [1.0.0] - 2026-02-08

### Added
- Initial release: lobby system, Night/Day phases, 7 roles (Werewolf, Villager, Seer, Witch, Hunter, Little Girl, Cupid)
- Village vote + captain vote, automatic voice mute/unmute, ambient audio
- Slash commands: `/create`, `/join`, `/start`, `/vote`, `/kill`, `/see`, `/potion`, `/end`, `/help`
- Debug commands for development
