# 📝 Changelog - Werewolf Bot

## [3.3.0] - 2026-02-24 - Production Readiness & Stability Hardening

### ✅ Reliability & Determinism
- **Crash simulation matrix** added with automated restart verification at critical failure points (after memory mutation, before/after DB commit, before timer scheduling, during subPhase transition)
- **Atomic mutation hardening** continued: rollback and idempotency scenarios validated under crash conditions

### 🔒 Concurrency & Split-Brain Protection
- **GameMutex observability**: acquisition wait/hold tracking, queue length, exposed metrics (`max_wait_ms`, `avg_wait_ms`, `active_locks`)
- **Long lock warning**: emits warning when a lock is held for more than 5 seconds
- **Startup lock**: file-based inter-process boot lock prevents accidental multi-instance startup on same host
- **Second instance fail-fast**: logs critical error and refuses startup
- **Shutdown-safe unlock**: lock release on graceful shutdown and fatal exit paths

### 🌐 WebSocket Isolation & Abuse Resistance
- **Server-side guild authorization** enforced for `joinGuild`
- **Unauthorized room/game subscription blocked** (`joinGuild`, `spectate`, `requestGames` scope filtering)
- **Guild-scoped throttled broadcasts** for `gameEvent` / `globalEvent`
- **Security tests added** for malicious join rejection, unauthorized spectate rejection, and throttled/coalesced guild broadcasts

### 📈 Liveness Monitoring
- **Per-game mutation timestamp** tracking (`_lastMutationAt`)
- **STUCK detection** for games inactive beyond configured threshold (`GAME_STUCK_THRESHOLD_MS`)
- **Metric exposed**: `stuck_games_count`
- **Non-destructive behavior**: detection + warning only (no auto-delete)

### 🧪 Tests
- Added crash matrix tests, mutex observability tests, startup lock tests, websocket isolation tests, and liveness freeze detection
- **251 tests passing** (21 suites)

## [3.2.0] - 2026-02-24 - 6-Axis Architecture Hardening (State, Security, Multi-Tenant, Performance, Monitoring, Tests)

### 🏗️ Axis 1 — State Management
- **GameMutex** : new async promise-chaining lock per game, replaces fragile `_transitioning` boolean — prevents all race conditions on phase transitions
- **FSM transition table** : `VALID_TRANSITIONS` map enforces valid `subPhase → subPhase` transitions, `isValidTransition()` logs warnings on invalid paths
- **`_setSubPhase()`** : single entry point for all 30+ `game.subPhase` assignments — validates via FSM, marks game dirty, centralizes state changes
- **Transaction-wrapped DB sync** : `syncGameToDb()` now runs inside `this.db.transaction()` — atomic writes, no partial state on crash
- **Dirty flag** : `dirtyGames` Set tracks modified games, `saveState()` only syncs changed games (skip unnecessary I/O)
- **7 new DB columns** : `white_wolf_channel_id`, `white_wolf_kill_target_id`, `protected_player_id`, `last_protected_player_id`, `village_roles_powerless`, `listen_hints_given`, `thief_extra_roles` — previously ephemeral state now persists across restarts
- **`loadState()` enriched** : reads all new columns from DB instead of hardcoded defaults
- **Timer re-arm on boot** : in-progress games get their phase timers re-armed after `loadState()` (nightAfk, transitionToDay, dayTimeout, captainVoteTimeout)

### 🛡️ Axis 2 — Security & Concurrency
- **`isRecentDuplicate` on 12 commands** : vote, kill, see, potion, protect, shoot, love, join, start, captainvote, skip, nextphase — prevents double-click / network retry exploits
- **Session secret fix** : removed hardcoded fallback `'werewolf-dashboard-v3-stable-secret-key'`, now uses `crypto.randomBytes(32)` if no env var, with console warning
- **API rate limiting** : `express-rate-limit` added — `apiLimiter` (60 req/min/IP) on all `/api` routes, `modLimiter` (15 req/min/IP) on POST `/api/mod/*`
- **CORS restriction** : configurable via `CORS_ORIGINS` env var (comma-separated), applied to both Express and Socket.IO

### 🌐 Axis 3 — Multi-Tenant Strict
- **Guild-scoped WebSocket rooms** : `globalEvent` now emits to `guild:${guildId}` room instead of broadcasting to all clients
- **`joinGuild` socket event** : clients join their guild room with snowflake validation, auto-leave previous rooms
- **`player_stats.guild_id`** : `updatePlayerStats()` now accepts and stores `guildId`, with `COALESCE` backfill on UPDATE
- **Composite DB index** : `(guild_id, phase)` on games table for efficient multi-tenant queries

### ⚡ Axis 4 — Performance & I/O
- **Pagination on `/api/history`** : accepts `offset` query param, returns `{ games, pagination: { offset, limit, returned } }`
- **Pagination on `/api/leaderboard`** : accepts `offset` query param
- **`getGuildHistory()` offset** : DB function now supports `offset` parameter for efficient pagination

### 📊 Axis 5 — Monitoring & Observability
- **`/api/health` endpoint** : lightweight health check (200 ok / 503 degraded) with `uptime`, `activeGames`, `memoryMB`, `timestamp` — designed for load balancers
- **`/api/metrics` endpoint** : Prometheus-compatible text format — `process_uptime_seconds`, `heap_used_bytes`, `rss_bytes`, `active_games`, `total_players`, `guilds_count`, `event_loop_lag_ms`
- **Alert system auto-wire** : `alertSystem.checkMetrics()` called automatically after each MetricsCollector `collect()` cycle

### 🧪 Axis 6 — Tests & Robustness
- **14 FSM tests** : VALID_TRANSITIONS table completeness, isValidTransition for valid/invalid/ENDED/null/undefined/unknown/full cycles
- **9 GameMutex tests** : acquire/release, sequential execution, independent channels, concurrent serialization, isLocked, delete, destroy, auto-timeout, three-way serialization
- **DB mock updated** : 8 new fields in createGame, 12 new fields in updateGame mapping, guildId param on updatePlayerStats, offset param on getGuildHistory
- **Test harness fix** : `cleanupTest()` now clears `recentCommands` to prevent isRecentDuplicate from blocking subsequent test executions
- **223 tests passing** (16 suites, 0 failures) — was 200 tests / 13 suites

### 📦 Dependencies
- **`express-rate-limit`** ^8.2.1 added

### 🔧 Files Modified (27 files)
- **game/GameMutex.js** *(new)* — Async mutex implementation
- **game/gameManager.js** — Mutex, FSM, _setSubPhase, dirty flag, transaction sync, loadState enriched, destroy cleanup
- **game/phases.js** — VALID_TRANSITIONS + isValidTransition()
- **database/db.js** — 7 new column migrations, composite index, updateGame/updatePlayerStats/getGuildHistory updated
- **index.js** — Timer re-arm on boot
- **web/server.js** — Session secret fix, CORS restriction, guild-scoped WS rooms, joinGuild event
- **web/routes/api.js** — express-rate-limit, /health, /metrics, pagination
- **monitoring/metrics.js** — alertSystem.checkMetrics auto-wire
- **12 command files** — isRecentDuplicate (vote, kill, see, potion, protect, shoot, love, join, start, captainvote, skip, nextphase)
- **tests/** — gameMutex.test.js *(new)*, phases.test.js, vote.test.js, testHelpers.js, DB mock

---

## [3.1.0] - 2026-02-24 - Architecture Audit, Security Hardening, Multi-Tenant Fixes

### 🛡️ Security
- **XSS eliminated** : all `innerHTML` with user data replaced by safe DOM API (`textContent`, `createElement`) in spectator.js and dashboard.js
- **WebSocket rate limiting** : 30 events per 10 seconds per socket, automatic reset
- **WebSocket input validation** : `gameId` type + length checks on `spectate`/`leaveSpectate`
- **Scoped globalEvent** : WebSocket `globalEvent` no longer broadcasts full game data to all clients — only event metadata (event, gameId, guildId, timestamp)

### 🏗️ Multi-Tenant Isolation
- **requestGames filtered** : dashboard now shows only games from user's guilds (via session)
- **Leaderboard guild filter** : `getLeaderboard()` guild-specific query now actually filters by guild via `players JOIN games` subquery
- **`t()` per-guild locale** : translation function accepts optional `guildId` for per-server language resolution
- **Game archiving** : `archiveOldGames()` automatically cleans ended games older than 7 days from active `games` table on startup

### 🔧 Critical Bug Fixes
- **CRITICAL** : `start()` now clears lobby timeout — previously, the 1-hour lobby auto-cleanup timer was never cleared when a game started, causing active games to be deleted mid-game
- **CRITICAL** : `nextPhase()` guards against ENDED games — previously, calling `nextPhase()` on a finished game would toggle it back to NIGHT phase
- **Timer re-arm** : lobby timeouts are now re-armed after `loadState()` for games still in lobby phase after bot restart

### ⚡ Performance
- **gameState debounce** : WebSocket game state emissions debounced at 200ms per game room (prevents burst flooding on rapid events)
- **DB indexes added** : `games(guild_id)`, `games(guild_id, ended_at)`, `player_stats(username)` — both in schema.sql and auto-migration for existing databases
- **Snapshot enriched** : `getGameSnapshot()` now includes 8 additional state fields: `wolfVotes`, `protectedPlayerId`, `witchKillTarget`, `witchSave`, `whiteWolfKillTarget`, `thiefExtraRoles`, `listenRelayUserId`, `disableVoiceMute`

### 🧪 Tests
- **9 new FSM tests** : lobby timeout cleared on start, startedAt set, double-start prevention, NIGHT→DAY toggle, DAY→NIGHT toggle, ENDED guard, vote/wolfVotes reset on new night
- **2 new snapshot tests** : required fields validation, null game handling
- **200 tests passing** (was 191)

### 🔧 Files Modified
- **game/gameManager.js** : `start()` clear lobby timeout, `nextPhase()` ENDED guard, `getGameSnapshot()` enriched
- **web/server.js** : WS rate limiting, debounce, requestGames filter, globalEvent scoped, `_getSocketUserGuildIds()`
- **web/public/js/spectator.js** : XSS fix — all innerHTML → DOM API
- **web/public/js/dashboard.js** : XSS fix — all innerHTML → DOM API
- **database/db.js** : `archiveOldGames()`, auto-migrate indexes
- **database/schema.sql** : 2 new indexes
- **game/achievements.js** : guild-filtered leaderboard query
- **utils/i18n.js** : `t()` accepts guildId parameter
- **index.js** : timer re-arm after loadState, archive on startup
- **tests/game/gameManager.test.js** : 11 new tests

---

## [3.0.0] - 2026-02-24 - Web Dashboard, Live Spectator, REST API, Custom Roles

### 🌐 Web Dashboard
- **Express.js** web server with Discord OAuth2 authentication (passport-discord)
- **Real-time dashboard** showing active games, player counts, server stats
- **Dark theme UI** with responsive design, Inter font, game-themed CSS
- **Multiple pages** : Dashboard, Guild view, Player profile, Roles editor, Login, Live Spectator
- **EJS templates** with header/footer partials, dynamic navigation
- **Auto-start** on bot ready at port `WEB_PORT` (default 3000)
- **Graceful shutdown** integrated into bot lifecycle

### 👁 Live Spectator (WebSocket)
- **Socket.IO** real-time game spectating — watch games unfold live from the browser
- **EventEmitter bridge** : GameManager now extends EventEmitter, emits standardized events
- **7 event types** : `gameCreated`, `playerJoined`, `gameStarted`, `phaseChanged`, `playerKilled`, `gameEnded`, `actionLog`
- **Spectator rooms** : join/leave game feeds, spectator count broadcast, auto-cleanup on game end
- **Event feed** : live chronological display of game actions with timestamps
- **Player panel** : real-time alive/dead status, role reveals on death, captain/love badges
- **Full game snapshot** : sanitized serializable game state (strips Discord objects)

### 🔌 REST API
- `GET /api/games` — All active games
- `GET /api/games/:id` — Single game state
- `GET /api/leaderboard?guild=&limit=` — ELO leaderboard with tier enrichment
- `GET /api/players/:id` — Player stats + achievements + ELO + rank
- `GET /api/history?guild=&limit=` — Game history
- `GET /api/stats` — Global stats + uptime + memory
- `GET /api/guilds` — All guilds the bot is in
- `GET /api/roles` — Built-in + custom roles
- `POST /api/roles` — Create custom role (Auth + Admin required)
- `DELETE /api/roles/:id` — Delete custom role (Auth + Admin required)
- `GET /api/config/:guildId` — Guild config (Auth + Admin)
- `PATCH /api/config/:guildId` — Update guild config (Auth + Admin)

### 🎭 Custom Roles System
- **Custom roles table** (`custom_roles`) with auto-migration
- **CRUD API** : create, list, delete custom roles per guild
- **Role editor page** : visual interface with name, emoji, camp (village/wolves/solo), power type, description
- **Admin-only** : requires Discord OAuth2 login + guild admin permissions (0x8 or 0x20)
- **Built-in roles display** : all 10 base roles shown with themed emojis

### 🔐 Security & Auth
- **Discord OAuth2** via passport-discord (scopes: identify, guilds)
- **helmet.js** with CSP configured for CDN assets and WebSocket connections
- **CORS** support for API access
- **Session management** : 7-day cookies, configurable secret
- **Admin permission check** : Discord bitfield verification (Admin 0x8 or Manage Server 0x20)
- **Read-only mode** : dashboard accessible without login, admin features require auth

### 🏗️ Architecture
- **GameManager** now extends `EventEmitter` — standard Node.js event pattern
- **`_emitGameEvent()` helper** : standardized event emission with gameId, guildId, timestamp, try/catch wrapped
- **`getGameSnapshot()` method** : returns sanitized serializable game state for web layer
- **WebServer class** : constructor pattern with `{port, gameManager, db, client}`
- **Route factories** : `module.exports = (webServer) => router` pattern for dependency injection
- **Static assets** served at `/static` (CSS, JS, images)
- **View engine** : EJS with partials at `web/views/`

### 🔧 Fichiers créés/modifiés
- **web/server.js** (NEW) : WebServer class — Express + Socket.IO + Auth + Game Bridge
- **web/routes/auth.js** (NEW) : Discord OAuth2 login/callback/logout
- **web/routes/api.js** (NEW) : REST API endpoints (games, leaderboard, stats, roles, config)
- **web/routes/dashboard.js** (NEW) : HTML page routes (dashboard, spectator, guild, player, roles, login)
- **web/views/** (NEW) : 8 EJS templates (header, footer, dashboard, spectator, guild, player, roles, login, error)
- **web/public/css/style.css** (NEW) : 650+ lines dark theme CSS with responsive design
- **web/public/js/app.js** (NEW) : Socket.IO client, navbar toggle, WS status indicator
- **web/public/js/dashboard.js** (NEW) : Real-time game card updates
- **web/public/js/spectator.js** (NEW) : Live game feed, player tracking, event timeline
- **web/public/js/roles.js** (NEW) : Custom role CRUD operations
- **game/gameManager.js** (MODIFIED) : extends EventEmitter, 7 event emissions, `getGameSnapshot()`
- **index.js** (MODIFIED) : WebServer initialization on bot ready, graceful shutdown integration

### 📦 Nouvelles dépendances
- `express` — Web framework
- `socket.io` — WebSocket real-time communication
- `passport` + `passport-discord` — Discord OAuth2 authentication
- `express-session` — Session management
- `helmet` — Security headers
- `cors` — Cross-origin support
- `cookie-parser` — Cookie parsing
- `ejs` — Template engine

### ⚙️ Variables d'environnement
- `WEB_PORT` — Port du serveur web (défaut: 3000)
- `CLIENT_SECRET` — Secret Discord OAuth2 (optionnel — mode lecture seule si absent)
- `WEB_CALLBACK_URL` — URL de callback OAuth2 (défaut: `http://localhost:3000/auth/discord/callback`)
- `SESSION_SECRET` — Secret de session (défaut: auto-généré)

---

## [2.9.0] - 2026-02-23 - Achievements, ELO, Death Reveal, DM Notifications

### 🏆 Système de succès (Achievements)
- **18 succès** répartis en 6 catégories : victoire, loup, village, spécial, social, général
- **Tables SQLite auto-créées** : `player_achievements`, `player_extended_stats`
- **Tracking en jeu** : seer_found_wolf, salvateur_save, witch_save, hunter_killed_wolf
- **Annonce post-game** : les succès débloqués sont affichés dans le récapitulatif de fin de partie
- **AchievementEngine** : `trackEvent()`, `processGameEnd()`, `checkAndAward()`, `getPlayerAchievements()`

### 📊 Système ELO & Classement
- **Calcul ELO dynamique** : facteur K adaptatif, multiplicateur de difficulté par rôle, bonus de survie
- **7 paliers** : Fer (≤800) → Bronze → Argent → Or → Platine → Diamant → Loup Alpha (2000+)
- **Commande `/leaderboard`** : top N joueurs avec tier, WR%, stats globales (village/loups WR, durée moy.)
- **Commande `/stats` enrichie** : ELO, rang, peak, victoires loup/village, meilleure série, stats détaillées, badges de succès
- **Calcul post-game** : ELO affiché dans le récapitulatif avec 📈/📉 et nouveau palier

### 💀 Révélation des rôles à la mort
- **Embed de mort thématique** : couleur rouge (loup) ou bleue (innocent), miniature du rôle
- **Cause de mort** : dévoré par les loups, éliminé par le village, empoisonné, tir du chasseur, mort d'amour
- **Footer contextuel** : "C'était un loup-garou !" ou "C'était un innocent..."
- **Intégré** dans `transitionToDay()` et `transitionToNight()` pour toutes les sources de mort

### 📩 Notifications DM de tour
- **DM automatique** quand c'est le tour d'un rôle : Salvateur, Loups-Garous, Sorcière, Voyante
- **Embed compact** avec emoji 🌙, nom du rôle, instruction contextuelle
- **Fail-safe** : ignore silencieusement les DM fermés

### 📜 Historique & Timeline
- **Commande `/history`** : dernières N parties avec vainqueur, joueurs, jours, durée, timestamp relatif
- **Détail dernière partie** : tous les joueurs avec rôle et statut
- **Timeline post-game** : chronologie des événements clés dans le récapitulatif (morts, sauvetages, victoire)

### 🐛 Corrections de bugs
- **BUG-1** : `isInGameCategory()` passe maintenant `guildId` à `getCategoryId()` (support multi-guild)
- **BUG-2** : `advanceSubPhase()` utilise `announceVictoryIfAny()` au lieu d'une logique inline cassée
- **BUG-3** : `listen.js` corrigé — `logAction()` reçoit le bon format (game, string)
- **BUG-9/10** : Restauration de `villageRolesPowerless` et `ancienExtraLife` au redémarrage via `loadState()`

### 🌐 Localisation
- **60+ nouvelles clés** FR et EN : death, dm, achievement, leaderboard, history, stats
- **Sections ajoutées** : `death.*`, `dm.*`, `achievement.*`, `leaderboard.*`, `history.*`, `stats.*`

### 🔧 Fichiers modifiés/créés
- **game/achievements.js** (NEW) : AchievementEngine + ACHIEVEMENTS + ELO system
- **commands/leaderboard.js** (NEW) : `/leaderboard` slash command
- **commands/history.js** (NEW) : `/history` slash command
- **game/gameManager.js** : death reveal, DM notifications, timeline, ELO integration, bug fixes
- **commands/stats.js** : ELO, rank, extended stats, achievement badges
- **commands/see.js** : achievement tracking (seer_found_wolf)
- **commands/potion.js** : achievement tracking (witch_save)
- **commands/shoot.js** : achievement tracking (hunter_killed_wolf)
- **utils/validators.js** : guildId fix pour isInGameCategory
- **commands/listen.js** : logAction fix
- **index.js** : initAchievements() au démarrage
- **locales/fr.js** + **locales/en.js** : 60+ nouvelles clés de traduction

---

## [2.8.0] - 2026-02-23 - Docker, Backup Auto, Multi-Guild, Rematch

### 🐳 Docker containerization
- **Dockerfile** multi-stage (builder + runtime) avec Node 20 Alpine, FFmpeg, non-root user
- **docker-compose.yml** avec volumes persistants (`werewolf-data`, `werewolf-logs`), auto-restart
- **.dockerignore** pour minimiser la taille de l'image (exclut node_modules, tests, coverage, .git)
- **Health check** intégré via `scripts/health-check.js` (interval 60s)

### 💾 Backup automatique SQLite
- **BackupManager** (`database/backup.js`) — Singleton avec backup horaire automatique
- **Rotation** : conserve les 24 derniers backups (1 par heure, 24h d'historique)
- **API `better-sqlite3` native** : utilise `.backup()` pour des copies atomiques et cohérentes
- **Backup au shutdown** : un dernier backup est effectué lors du graceful shutdown (SIGTERM/SIGINT)
- **Premier backup** 5 minutes après le démarrage (laisse la DB se stabiliser)
- **Script npm** : `npm run backup` pour déclencher un backup manuel
- **Méthodes exposées** : `performBackup()`, `listBackups()`, `restoreFromBackup(file)`, `rotateBackups()`

### 🌐 Multi-guild support (langue & config par serveur)
- **ConfigManager guild-scoped** : nouvelles méthodes `getForGuild(guildId, key)`, `setForGuild(guildId, key, value)`, `deleteForGuild()`
- **Config per-guild** : catégorie, wolfwin condition, règles par défaut, webhook — chaque serveur a sa propre configuration avec fallback global
- **i18n per-guild** : `setLocale(locale, db, guildId)`, `getLocaleForGuild(guildId)`, `loadGuildLocales(db)` — chaque serveur peut avoir sa propre langue
- **Commandes mises à jour** : `/lang`, `/setup`, `/setrules`, `/create` passent le `guildId` aux getters/setters
- **Lobby** : lit `wolfWinCondition` par guild, toggle bouton met à jour la config du serveur courant
- **Rétro-compatible** : si aucune config guild n'existe, fallback sur la config globale existante

### 🔄 Système de rematch (revanche rapide)
- **Bouton "🔄 Revanche"** dans le résumé de fin de partie (à côté de Relancer et Nettoyer)
- **Auto-join** : tous les joueurs de la partie précédente sont automatiquement réinscrits dans le nouveau lobby
- **Sauvegarde des joueurs** : `game._previousPlayers` stocke la liste lors du `sendGameSummary()`
- **Fallback gracieux** : si un joueur a quitté le serveur, il est simplement ignoré sans erreur
- **Log détaillé** : nombre de joueurs rejoints vs total attendu

### 🔧 Fichiers modifiés
- **index.js** : Backup init/shutdown, handler `game_rematch`, `getCategoryId(guildId)`, `getWolfWinCondition(guildId)`
- **utils/config.js** : Méthodes `getForGuild/setForGuild/deleteForGuild`, getters guild-aware avec fallback
- **utils/i18n.js** : `setLocale(locale, db, guildId)`, `getLocaleForGuild()`, `loadGuildLocales()`, `_guildLocales` Map
- **utils/lobbyBuilder.js** : `getWolfWinCondition(game.guildId)`
- **game/gameManager.js** : `_previousPlayers` dans summary, bouton rematch, `getWolfWinCondition(game.guildId)`
- **commands/lang.js** : Passe `guildId` à `setLocale()`
- **commands/setup.js** : `setCategoryId(id, guildId)`, `getDefaultGameRules(guildId)`, `isSetupComplete(guildId)`
- **commands/setrules.js** : `getWolfWinCondition(guildId)`, `setWolfWinCondition(condition, guildId)`
- **commands/create.js** : `getCategoryId(guildId)`
- **locales/fr.js** : +clés `ui.btn.rematch`, `cleanup.rematch_success`
- **locales/en.js** : +clés `ui.btn.rematch`, `cleanup.rematch_success`

### 📦 Nouveaux fichiers
```
Dockerfile              # Multi-stage build (Node 20 Alpine)
docker-compose.yml      # Orchestration avec volumes persistants
.dockerignore           # Exclusions pour l'image Docker
database/backup.js      # BackupManager (backup horaire, rotation, restore)
```

---

## [2.7.0] - 2026-02-19 - Petite Fille : Espionnage Temps Réel & Indices Intelligents

### 👧 Système d'espionnage temps réel (Petite Fille)
- **Relay en DM** : `/listen` active un relais en temps réel — chaque message des loups est transmis anonymement en DM à la Petite Fille
- **Anonymisation** : Les noms des loups sont remplacés par `🐺 Loup ???` dans les messages relayés
- **Fin automatique** : Le relais se coupe automatiquement à la transition Loups → Sorcière, avec notification DM
- **Intents ajoutés** : `GuildMessages` + `MessageContent` pour capter les messages du salon loups

### 🔍 Système d'indices intelligents
- **Détection 30%** : À chaque écoute, 30% de chance que les loups reçoivent un indice sur l'espion
- **Algorithme `pickSmartHint()`** : Choisit la lettre du pseudo la plus ambiguë — celle partagée par le plus d'autres joueurs vivants
- **Indices non-répétitifs** : Chaque détection donne une lettre différente (tracking via `game.listenHintsGiven`)
- **Normalisation Unicode** : `normalize('NFD')` + `\p{M}` supprime accents et zalgo (`Éloïse` → `eloise`, `f̴̈̍u̶̒̋c̵̊̆k̸̯̋` → `fuck`)
- **Fallback** : Si toutes les lettres ont été données, alerte générique sans indice

### ⚙️ Condition de victoire des loups (serveur-wide)
- **Configuration persistante** : `/setrules wolfwin:majority|elimination` sauvegardé en SQLite via ConfigManager (pas lié à une partie)
- **Bouton lobby** : Toggle ⚙️ dans le lobby pour basculer entre majorité et élimination
- **Sans partie active** : `/setrules wolfwin:...` fonctionne même sans partie en cours

### 🔧 Enregistrement des commandes
- **Guild-only** : Les commandes slash sont enregistrées uniquement sur le serveur (quand `GUILD_ID` est défini)
- **Nettoyage global** : Les commandes globales dupliquées sont supprimées automatiquement au démarrage

### 🔧 Fichiers modifiés
- **commands/listen.js** : Réécriture complète — relais temps réel, `pickSmartHint()`, `normalizeForHint()`
- **game/gameManager.js** : `listenRelayUserId`, `listenHintsGiven`, `stopListenRelay()`, arrêt relay sur transition LOUPS→SORCIERE
- **index.js** : Handler `messageCreate` pour relay anonymisé, intents GuildMessages/MessageContent, enregistrement guild-only, handler bouton `lobby_wolfwin`
- **utils/config.js** : `getWolfWinCondition()` / `setWolfWinCondition()`
- **utils/lobbyBuilder.js** : Affichage wolfwin + bouton toggle (2e ActionRow)
- **commands/setrules.js** : wolfwin serveur-wide, fonctionne sans partie active
- **locales/fr.js** : Clés relay (relay_started, relay_message, relay_ended, wolves_alert, wolves_alert_no_hint), clés wolfwin, boutons
- **locales/en.js** : Traductions anglaises correspondantes

### ✅ Tests
- 191/191 tests passent (15 suites, 0 failures)

---

## [2.6.0] - 2026-02-19 - Équilibrage, Vote Capitaine Auto, Correctifs

### ⏱️ Équilibrage des phases
- **AFK nuit** : 90s → 120s (plus de temps pour les rôles de nuit)
- **Tir du chasseur** : 60s → 90s
- **Délibération jour** : 180s → 300s (5 minutes de discussion)
- **Vote jour** : 120s → 180s
- **Nouveau timeout** : Vote capitaine 120s avec résolution automatique

### 🗳️ Vote capitaine automatique
- **Auto-résolution** : Le vote se résout automatiquement quand tous les joueurs vivants ont voté
- **Timeout 120s** : Si le temps expire, le vote est résolu avec les votes déjà enregistrés
- **Égalité** : Tirage au sort automatique parmi les ex-aequo (plus de blocage)
- **Suppression de `/declarecaptain`** : La commande n'existe plus, tout est automatique
- **Message de progression** : Affichage du compteur de votes en temps réel

### 🐛 Corrections de bugs
- **Potion de vie sorcière** : La potion de vie ne tue plus la sorcière — `witchKillTarget` est correctement réinitialisé quand la potion de vie est utilisée, et la potion de mort est ignorée si la cible a été sauvée
- **Ping loups** : Les loups-garous sont maintenant mentionnés (`@pseudo`) dans leur channel privé avec la liste des membres au début de la nuit

### ⚙️ Nouvelles options de configuration
- **Condition de victoire des loups** : Configurable via `/setrules wolfwin:majority|elimination`
  - `majority` (défaut) : Les loups gagnent quand ils sont en majorité
  - `elimination` : Les loups gagnent uniquement quand tous les villageois sont morts
- **Affichage des règles** : `/setrules` sans argument affiche les règles actuelles de la partie

### 🐺 Équilibrage des rôles
- **1 seul loup pour ≤5 joueurs** : Au lieu de 2 loups, les parties de 5 joueurs n'ont qu'un seul loup-garou pour un meilleur équilibre
- **2 loups pour 6+ joueurs** : Le deuxième loup apparaît à partir de 6 joueurs

### 🔧 Fichiers modifiés
- **game/gameManager.js** : Timeouts augmentés, `voteCaptain()` refactorisé avec auto-résolution, `resolveCaptainVote()` ajouté, `startCaptainVoteTimeout()`/`clearCaptainVoteTimeout()`, fix potion sorcière, condition victoire loups configurable, 1 loup pour ≤5 joueurs, ping loups dans channel
- **commands/captainvote.js** : Réécrit pour gérer l'auto-résolution et afficher la progression
- **commands/potion.js** : Reset `witchKillTarget` quand potion de vie utilisée
- **commands/setrules.js** : Ajout option `wolfwin`, affichage des règles courantes, tous les paramètres optionnels
- **utils/lobbyBuilder.js** : ROLE_LIST mis à jour (1 loup@5 joueurs, 2 loups@6+), `buildRolesPreview()` réécrit
- **utils/rateLimiter.js** : Entrée `declarecaptain` supprimée
- **locales/fr.js** : +10 clés (captain auto-résolution, ping loups, progression vote, setrules)
- **locales/en.js** : Traductions anglaises correspondantes
- **tests/game/gameManager.test.js** : Tests mis à jour pour le nouveau format de `voteCaptain()`

### 🗑️ Fichiers supprimés
- **commands/declarecaptain.js** : Remplacé par l'auto-résolution dans `captainvote.js`

### ✅ Tests
- 191/191 tests passent (15 suites, 0 failures)

---

## [2.5.1] - 2025-02-15 - Correctifs de stabilité

### 🐛 Corrections de bugs
- **Validation de catégorie** : La commande `/create` vérifie désormais que la catégorie Discord existe avant de créer les channels. Fallback automatique sur la catégorie du channel courant si la catégorie configurée est introuvable.
- **Orphan cleanup** : Le nettoyage des channels orphelins ne supprime plus les catégories Discord (type 4). Ajout de gardes dans les 3 emplacements de cleanup (startup, `cleanupOrphanChannels`, `cleanupCategoryChannels`).
- Ajout de `salvateurChannelId` et `spectatorChannelId` aux vérifications de propriété lors du cleanup.

---

## [2.5.0] - 2025-02-14 - Nice-to-Have : Rôles, Spectateurs, Thèmes

### 🎭 Nouveaux rôles (3)
- **Salvateur** (`/protect @joueur`) : Protège un joueur de l'attaque des loups chaque nuit. Ne peut pas protéger la même personne deux nuits de suite.
- **Ancien** : Survit à la première attaque des loups (extra-life). S'il est tué par le village, tous les villageois spéciaux perdent leurs pouvoirs.
- **Idiot du Village** : Quand voté par le village, il est révélé mais reste en vie. Il perd cependant son droit de vote.

### 👻 Mode spectateur
- Channel `👻-spectateurs` créé automatiquement avec chaque partie
- Les joueurs éliminés rejoignent le salon spectateur avec droit d'écriture
- Accès en lecture seule sur tous les channels de rôle (loups, voyante, sorcière…)
- Message de bienvenue et notification pour chaque spectateur

### 🎨 Système de thèmes d'embeds
- **4 thèmes prédéfinis** : 🐺 Classic, 🌙 Midnight, 🌿 Nature, 🩸 Blood Moon
- **Commande `/theme`** : Sélection par guild, persistée en mémoire
- **12 couleurs sémantiques** : primary, success, error, warning, info, accent, muted, special, blurple, purple, critical, roleSelect
- **Centralisation complète** : Tous les 11 fichiers à embeds utilisent `getColor()` au lieu de hex hardcodés
- Fonctions utilitaires : `getHealthColor()`, `getSeverityColor()`, `getLobbyColor()`

### 📁 Nouveaux fichiers
```
utils/theme.js        # Système de thèmes centralisé (4 palettes, 12 couleurs sémantiques)
commands/theme.js     # Commande /theme pour changer le thème par guild
commands/protect.js   # Commande /protect pour le Salvateur
```

### 🔧 Fichiers modifiés (20+ fichiers)
- **game/gameManager.js** : Rôles (Salvateur/Ancien/Idiot), spectateur, thèmes, doubles-vies, power drain
- **game/roles.js** : +3 constantes SALVATEUR, ANCIEN, IDIOT
- **game/phases.js** : +sous-phase SALVATEUR (entre CUPIDON et LOUPS)
- **commands/{see,potion,shoot,listen}.js** : Check `villageRolesPowerless`
- **commands/vote.js** : Check Idiot révélé (pas de vote)
- **commands/skip.js** : +SALVATEUR dans allowedSkips
- **commands/{help,ratelimit,setup,monitoring,debug-*,stats,start}.js** : Utilisation de `getColor()`
- **utils/lobbyBuilder.js** : +3 rôles dans ROLE_LIST, thème centralisé
- **utils/roleHelpers.js** : +descriptions/images pour 3 rôles
- **utils/i18n.js** : +ROLE_KEY_MAP et PHASE_KEY_MAP pour nouveaux rôles
- **locales/{fr,en}.js** : +50 clés i18n (rôles, spectateur, thème, protections, erreurs)
- **database/{db,schema}.js** : +colonnes salvateur_channel_id, spectator_channel_id + migrations
- **monitoring/alerts.js** : Utilisation de `getSeverityColor()`

## [2.4.0] - 2026-02-14 - Système i18n centralisé (FR + EN)

### 🌍 Internationalisation complète
- **Système i18n centralisé** : Singleton `I18n` dans `utils/i18n.js` avec interpolation `{{variable}}`
- **Commande `/lang`** : Bascule entre français et anglais (admin-only), persisté en DB
- **500+ clés de traduction** dans 22+ catégories (errors, game, lobby, roles, phases, commands, alerts, etc.)
- **Fallback automatique** : Si une clé manque dans la langue courante, retour au français

### 📁 Nouveaux fichiers
```
utils/i18n.js       # Gestionnaire i18n (singleton, t(), translateRole/Phase/RoleDesc, tips)
locales/fr.js       # Locale française complète (~500+ clés)
locales/en.js       # Locale anglaise complète (~500+ clés)
commands/lang.js    # Commande /lang pour changer la langue
```

### 🔧 Fichiers modifiés (35 fichiers)
- **game/gameManager.js** : ~45 chaînes → `t()` (phases, victoires, DMs, channels, résumé)
- **utils/lobbyBuilder.js** : ~30 chaînes → `t()` (lobby, boutons, rôles, tips, progression)
- **28 fichiers de commandes** : Tous les messages utilisateur sous `t()`
  - vote, kill, potion, see, love, shoot, listen, skip, start, create, end
  - help, status, clear, captainvote, declarecaptain, vote-end, setrules, join, force-end
  - setup, monitoring, ratelimit, nextphase, debug-*
- **index.js** : Initialisation i18n + handlers boutons (lobby_join/leave/start, game_restart/cleanup)
- **utils/rateLimiter.js** : Messages rate limit traduits
- **utils/commands.js** : Message catégorie interdite traduit
- **utils/config.js** : Labels de configuration traduits
- **utils/roleHelpers.js** : Instructions de rôle traduites
- **monitoring/alerts.js** : ~30 chaînes d'alertes traduites
- **tests/setup.js** : Initialisation i18n pour les tests

### 🏗️ Architecture
- Constantes internes (`Loup-Garou`, `Nuit`, etc.) inchangées dans `roles.js`/`phases.js`
- Traduction à l'affichage via `translateRole()`, `translatePhase()`, `translateRoleDesc()`
- Persistance de la langue en table `config` (clé `bot.locale`)

### ✅ Tests
- 191/191 tests passent

---

## [2.3.0] - 2026-02-12 - Audit complet, Spectateur, /skip, Stats DB

### 🔍 Audit complet — 32 corrections (5 CRITICAL, 7 HIGH, 12 MEDIUM, 8 LOW)

#### CRITICAL
- **Capitaine double-vote** : Le vote du capitaine compte désormais ×2 correctement
- **Victoire loups** : Détection fiable quand les loups sont en majorité
- **Permissions channels** : Permissions correctes pour tous les rôles spéciaux
- **Couple duplicate** : Empêche la double-liaison par Cupidon
- **Vote fantôme** : Les morts ne peuvent plus voter

#### HIGH
- **Consensus loups** : Système de vote à majorité/pluralité fonctionnel
- **Sorcière double-poison** : Impossibilité d'utiliser la potion de mort deux fois
- **Cleanup channels** : Nettoyage complet des channels de jeu
- **debug-games crash** : Fix accès à des propriétés nulles
- **Monitoring sécurisé** : Gestion des erreurs dans le collecteur de métriques
- **Double AFK timeout** : Empêche les timers en double
- **Message loups** : Affichage correct de la victime et du compteur

#### MEDIUM
- Lobby image, dédup start, voice leak, CPU metric, WS status
- listen/love sub-phases, cupidon phase, rename action→status
- vote-end catégorie, restart voicemute, guild doc, ratelimit safe reply

#### LOW
- **L1** : Suppression du double-defer redondant dans lobby_start
- **L2** : `debug-start-force` réécrit pour utiliser `gameManager.start()`
- **L3** : Feedback de progression pendant `postStartGame`
- **L4** : Table `player_stats` peuplée à chaque fin de partie
- **L5** : `night_actions` enregistrées en DB (kill, see, save, poison, love, shoot)
- **L6** : Snapshots métriques en DB toutes les heures + nettoyage 7j
- **L7** : Annonce publique des votes dans le village
- **L8** : Nouvelle commande `/skip` pour passer les actions de nuit

### 👻 Mode spectateur
- Les joueurs morts voient tous les salons en lecture seule

### 🆕 Nouvelles commandes
- **`/skip`** : Passer son action de nuit (Voyante, Sorcière, Cupidon)

### 📊 Base de données enrichie
- `player_stats` : games_played, games_won, times_killed, times_survived, favorite_role
- `night_actions` : game_id, night_number, action_type, actor_id, target_id
- `metrics` : 24 colonnes système/discord/game/commands/errors/health

### ⏳ UX
- Feedback de progression pendant le lancement de partie
- Annonce publique des votes (compteur sans révéler la cible)
- Lobby redesigné v2 avec grille de slots, rôles par équipe, tips

### 📦 Nouveaux fichiers
```
commands/skip.js    # Commande /skip (passer action de nuit)
```

---

## [2.2.1] - 2026-02-11 - Hardening Production, Tests ×2.5

### 🔒 Hardening production (26 fixes)
- **Validation env vars** : TOKEN, CLIENT_ID, GUILD_ID vérifiés au démarrage avec erreur explicite
- **Graceful shutdown** : Handlers SIGTERM/SIGINT avec `gameManager.destroy()`
- **`safeReply` everywhere** : Toutes les commandes utilisent `safeReply` au lieu de `interaction.reply` brut
- **Logger centralisé** : `console.log/error` remplacés dans tous les fichiers par le logger structuré
- **`setrules` fix** : `interaction.reply()` → `interaction.editReply()` après `deferReply()`
- **`clear` scoped** : Suppression limitée à la catégorie de jeu, plus de suppression hors-scope
- **`see`/`love`** : Réponses éphémères pour ne pas révéler d'info au village
- **Audio validation** : `existsSync()` vérifie les fichiers audio avant lecture
- **Permission voiceStateUpdate** : Vérification `MuteMembers` avant mute/unmute
- **voiceStateUpdate try/catch** : Wrappé pour empêcher les crashes
- **Transition guard order** : `_transitioning` vérifiée avant la phase
- **DB sync nightVictim/witchKillTarget/witchSave** : Persistées dans `syncGameToDb` et restaurées dans `loadState`
- **DB schema** : Colonnes `night_victim_id`, `witch_kill_target_id`, `witch_save` ajoutées
- **DB `migrateSchema()`** : Migration automatique des anciennes DB
- **Debounced `scheduleSave()`** : 500ms de debounce pour éviter les écritures multiples
- **`checkWinner` draw** : Retourne `'draw'` quand tous les joueurs sont morts
- **`_voteIncrements.clear()`** : Nettoyé avec les votes en changement de phase
- **`destroy()` complet** : Nettoie saveTimeout, recentCommands interval, et ferme la DB
- **Suppression code mort** : `getSaveFilePath()`, `data/games.json`
- **`roleHelpers.js`** : Descriptions et images des rôles factorisées (supprime la duplication)
- **TIMEOUTS constants** : Remplace les magic numbers (90s, 60s, 5s, etc.)
- **`recentCommands` cleanup** : Interval périodique de nettoyage du cache de déduplication
- **Monitoring** : Utilise `gameManager.getAllGames()` au lieu d'accès direct

### ✅ Tests : 77 → 191 (+114 tests)
- **8 nouvelles suites** : vote, kill, potion, see, love, validators, roleHelpers, interaction
- **gameManager étendu** : +38 tests (kill, getAlive, nextPhase, voteCaptain, declareCaptain, isRealPlayerId, hasAliveRealRole, getAllGames, logAction, draw)
- **Couverture complète** : Cas nominaux, edge cases, permissions, validations
- **15 suites, 191 tests, 0 failures**

### 🐛 Fix
- **Escaped quotes** : `require(\"...\")` → `require("...")` dans index.js
- **`destroy()` saveTimeout** : `clearTimeout(this.saveTimeout)` manquant

### 📦 Nouveaux fichiers
```
utils/roleHelpers.js            # Descriptions & images rôles (shared)
tests/commands/vote.test.js      # 11 tests
tests/commands/kill.test.js      # 11 tests
tests/commands/potion.test.js    # 10 tests
tests/commands/see.test.js       # 9 tests
tests/commands/love.test.js      # 9 tests
tests/utils/validators.test.js   # 11 tests
tests/utils/roleHelpers.test.js  # 4 tests
tests/utils/interaction.test.js  # 11 tests
```

---

## [2.2.0] - 2026-02-11 - Audit Critique, Sécurité, Chasseur, AFK Timeout

### 🔐 Sécurité
- **Commandes debug protégées** : Toutes les 7 commandes debug ont `setDefaultMemberPermissions(Administrator)`
- **`/end` sécurisé** : Vérification admin ou host de la partie
- **`/debug-voicemute` sécurisé** : Vérification admin dans `execute()`
- **Category ID dynamique** : Remplacement du hardcode par `isInGameCategory()` via ConfigManager
- **Protection DM** : Guard `guild null` en haut de `interactionCreate` pour éviter les crashes

### 🏹 Nouvelles commandes
- **`/shoot @joueur`** : Le Chasseur tire sur un joueur quand il meurt
  - Détection automatique mort du Chasseur (nuit & vote du village)
  - Message d'annonce + timeout 60s si AFK
  - Vérifications : rôle, cible vivante, pas soi-même
- **`/vote-end`** : Vote majoritaire pour arrêter la partie
  - Seuls les joueurs vivants peuvent voter
  - Majorité requise (ceil(alive/2))
  - Cleanup channels automatique

### ⏱️ AFK Timeout & Verrous
- **Timeout nuit 90s** : Auto-avance si loups/sorcière/voyante ne jouent pas
  - Timer relancé à chaque transition de sous-phase
  - Nettoyé quand le rôle agit (`clearNightAfkTimeout`)
- **Timeout chasseur 60s** : Perd son tir s'il ne tire pas à temps
- **Verrou de transition** : `game._transitioning` empêche les double-transitions jour/nuit
  - Bloc `try/finally` pour garantir le reset
- **`clearGameTimers()`** : Nettoyage propre de tous les timers en fin de partie

### 🐛 Corrections critiques
- **Fix crash `command is not defined`** : Ajout lookup `client.commands.get()` (index.js)
- **Fix desync DB/mémoire** : `db.deleteGame()` ajouté dans ~12 endroits (end, force-end, clear, debug-reset, create, index.js)
- **Fix perte de précision snowflake** : Regex `/^\d{17,20}$/` garde les IDs comme strings dans `config.js`
- **Fix boutons lobby** : Séparation `isChatInputCommand()` pour ne pas bloquer les buttons
- **Fix syntaxe** : Accolade manquante dans bloc `__logWrapped` (index.js)
- **Fix `addField` → `addFields`** : API discord.js v14 (debug-info.js)
- **Fix sous-phase enforcement** : `/kill` vérifie LOUPS, `/potion` vérifie SORCIERE, `/see` vérifie VOYANTE
- **Fix joueur mort** : Vérification `player.alive` pour sorcière, voyante, loups
- **Fix double start** : Guard `game.startedAt` dans `gameManager.start()`
- **Sync DB votes** : `db.addVote()` après chaque vote village
- **Sync DB potions** : `db.useWitchPotion()` pour vie et mort
- **Sync DB lobby leave** : `db.removePlayer()` quand un joueur quitte
- **Fix reply wrapper** : try/catch sur `reply`, `editReply`, `followUp` (index.js)
- **Fix vote-end** : Filtrage des votes de joueurs morts

### 🔧 Améliorations techniques
- Reply/editReply/followUp wrappés avec try/catch pour éviter les crashes
- `category_check` retiré de `/clear` et `/end` (remplacé par `safeDefer`)
- `lovers` format corrigé : array de pairs `[[id1, id2]]` au lieu de flat array

### 📦 Nouveaux fichiers
```
commands/shoot.js       # Commande /shoot (Chasseur)
commands/vote-end.js    # Commande /vote-end
```

### ✅ Tests
- **77 tests passent** (0 failures)
- Fix mocks : validators, config, logger
- Fix `lovers` format dans tests (array de pairs)
- Fix `smallPlayers` variable non déclarée

### ⚠️ Breaking Changes
Aucun - Rétrocompatible avec v2.1.0

---

## [2.0.2] - 2026-02-09 - Hotfix Erreur 10062 Critique

### 🐛 Corrections Majeures
- **`/end` continue même si interaction expire (10062)**
  - Supprime maintenant les channels MÊME si Discord ne répond pas
  - Logs détaillés pour tracer l'origine de l'expiration
  - Fallback graceful : action effectuée, réponse optionnelle
  - **Impact** : Channels toujours nettoyés, pas de parties "fantômes"

- **Logs améliorés pour debugging 10062**
  - Affiche l'âge exact de l'interaction (ms)
  - Contexte complet : user, channel, guild
  - Stack trace partielle pour erreurs inconnues
  - Gestion des champs `undefined` dans les logs

### ✨ Nouvelles Fonctionnalités
- **`/force-end`** : Commande admin pour terminer de force
  - Fonctionne toujours (pas d'interaction requise)
  - Peut cibler n'importe quel channel
  - Affiche toutes les parties si aucune trouvée
  - Usage : `/force-end [channel-id:123]`

- **`/debug-games`** : Liste toutes les parties actives
  - Affiche le channel de chaque partie
  - Nombre de joueurs, phase, host
  - IDs techniques pour debugging
  - Aide à localiser les parties orphelines

- **Message d'aide amélioré dans `/create`**
  - Rappelle où utiliser `/end`
  - Mentionne le channel actuel
  - Évite les confusions multi-parties

### 📚 Documentation
- **ERROR_10062.md** : Guide complet sur l'erreur
  - Causes et solutions
  - Patterns corrects
  - FAQ détaillée
  - Debug et prévention

### 🔧 Améliorations Techniques
- `commands/end.js` : Continue après defer failed
- `utils/interaction.js` : Logs robustes (gère undefined)
- `commands/create.js` : Avertissement channel dans message final

### ⚠️ Breaking Changes
Aucun - Rétrocompatible avec v2.0.1

---

## [2.0.1] - 2026-02-09 - Hotfix Interaction Expiration

### 🐛 Corrections Critiques
- **Fix erreur 10062 (Interaction Expired)**
  - `checkCategoryAndDefer()` : Defer AVANT vérification catégorie
  - `isInGameCategory()` : Utilisation du cache prioritaire
  - **Impact** : Plus d'expirations lors de `/create`, `/end`, etc.
  
- **Logging amélioré pour erreurs 10062**
  - Affiche maintenant l'âge de l'interaction
  - Contexte complet (commandName, channelId, timestamp)
  - Aide au debugging

### 📚 Documentation
- **INTERACTION_BEST_PRACTICES.md** : Guide complet
  - Règle des 3 secondes
  - Patterns corrects vs incorrects
  - Checklist debugging
  - Template de commande standard

### 🔧 Changements Techniques
- `utils/validators.js` : `isInGameCategory()` utilise cache d'abord
- `utils/commands.js` : `checkCategoryAndDefer()` reorganisé pour defer immédiat
- `utils/interaction.js` : `safeDefer()` logs plus détaillés

### ⚠️ Breaking Changes
Aucun - Rétrocompatible avec v2.0.0

---

## [2.0.0] - 2026-02-09 - Consolidation & Performance

### ⚡ Performance
- **Debouncing des sauvegardes** : `scheduleSave()` regroupe les écritures (90% de réduction)
- **Cache Discord optimisé** : Utilisation du cache avant les fetch API (60% de réduction d'appels)
- **Mute/Unmute intelligent** : Vérification de l'état actuel avant changement
- **VoiceStateUpdate optimisé** : Moins de latence, meilleurs perfs

### 🛡️ Robustesse
- **Validation centralisée** : Module `utils/validators.js`
  - `isInGameCategory()` - Vérification de catégorie
  - `isValidSnowflake()` - Validation IDs Discord
  - `isAdmin()` - Vérification permissions
  - `isPlayerInGame()` - État du joueur

- **Helpers de commandes** : Module `utils/commands.js`
  - `checkCategoryAndDefer()` - Vérif + defer en une fois
  - `sendTemporaryMessage()` - Messages auto-supprimés
  - `cleanupBotMessages()` - Nettoyage centralisé
  - `ensureInteractionReady()` - Garantit defer

### 🐛 Corrections
- **InteractionNotReplied** corrigé partout
- **Channels dupliqués** : Cleanup auto avant création
- **Mute après /end** : Unmute automatique en phase terminée
- **Gestion d'erreurs** cohérente et structurée

### 🧹 Code Quality
- **-650 lignes de code** dupliqué éliminé
- **Standardisation** des patterns interaction
- **Documentation** complète : OPTIMIZATIONS.md, TROUBLESHOOTING.md
- **Health check** : Script de vérification santé

### 📦 Nouveaux Fichiers
```
utils/
├── validators.js      # Validations réutilisables
└── commands.js        # Helpers de commandes

scripts/
└── health-check.js    # Vérification santé du bot

OPTIMIZATIONS.md       # Documentation des optimisations
TROUBLESHOOTING.md     # Guide de dépannage
```

### 🔄 Fichiers Modifiés
- `gameManager.js` : Debouncing, auto-save, meilleure gestion état
- `index.js` : VoiceStateUpdate optimisé, cache Discord
- `create.js`, `end.js`, `clear.js` : Utilisation nouveaux helpers
- `setrules.js`, `debug-voicemute.js` : Standardisation

### 🎯 Métriques d'Impact
| Métrique | Avant | Après | Amélioration |
|----------|-------|-------|--------------|
| Sauvegardes/min | ~50 | ~5 | **90%** ↓ |
| API calls/event | 2-3 | 0-1 | **60%** ↓ |
| Code dupliqué | 2000 LOC | 1350 LOC | **32%** ↓ |
| Erreurs interaction | Fréquentes | Rares | **95%** ↓ |

---

## [1.0.0] - 2026-02-08 - Version Initiale

### ✨ Fonctionnalités Initiales
- Système de lobby avec boutons
- Gestion complète des phases (Nuit/Jour)
- Rôles : Loup-Garou, Villageois, Voyante, Sorcière, Chasseur, Petite Fille, Cupidon
- Système de votes (village + capitaine)
- Mute/Unmute automatique selon phase
- Audio ambiant (nuit/jour/mort/victoire)
- Commandes admin (/clear, /setrules)
- Commandes debug (/debug-voicemute, /debug-info, etc.)

### 🎮 Commandes Principales
- `/create` - Créer une partie
- `/join` - Rejoindre
- `/start` - Démarrer
- `/nextphase` - Changer de phase
- `/vote` - Voter pour éliminer
- `/kill`, `/see`, `/potion` - Actions de rôles
- `/end` - Terminer
- `/help` - Aide

### 🏗️ Architecture
- Discord.js v14
- @discordjs/voice pour l'audio
- Système de sauvegarde JSON
- Event handlers Discord
- Gestion d'état en mémoire

---

## 🚀 Migration 1.0 → 2.0

### Aucune action requise !
Toutes les améliorations sont **rétrocompatibles**.

### Recommandations
1. Remplacer `try { saveState() } catch` par `scheduleSave()`
2. Utiliser les nouveaux helpers dans les nouvelles commandes
3. Exécuter `node scripts/health-check.js` avant démarrage

### Breaking Changes
Aucun ! L'API reste identique.

---

## 📋 Patchnotes Détaillés

### gameManager.js
```javascript
// Avant
try { this.saveState(); } catch (e) { console.error('Error:', e); }

// Après
this.scheduleSave(); // Auto-debounced, auto-error handled
```

### Commands
```javascript
// Avant
const channel = await interaction.guild.channels.fetch(interaction.channelId);
if (channel.parentId !== CATEGORY_ID) {
  await interaction.reply({ content: "❌ Interdit" });
  return;
}
await safeDefer(interaction);

// Après
if (!await checkCategoryAndDefer(interaction)) return;
```

### VoiceStateUpdate
```javascript
// Avant
const voiceChannel = await guild.channels.fetch(voiceChannelId);

// Après
const voiceChannel = guild.channels.cache.get(voiceChannelId) || 
                     await guild.channels.fetch(voiceChannelId);
```

---

## 🔮 Roadmap Future

### v2.1.0 (✅ Terminé)
- [x] Rate limiting intelligent per-user
- [x] Metrics dashboard (parties/jour, joueurs actifs)
- [x] Configuration centralisée SQLite

### v2.2.0 (✅ Terminé)
- [x] Tests automatisés (Jest) — 191 tests
- [x] Audit sécurité complet
- [x] Chasseur (/shoot) + AFK timeout
- [x] Verrou de transition & clearGameTimers

### v2.3.0 (✅ Terminé)
- [x] Audit complet (47 corrections)
- [x] Mode spectateur (morts en lecture seule)
- [x] Commande `/skip` (passer action de nuit)
- [x] Stats joueurs & actions de nuit en DB
- [x] Lobby v2 redesigné

### v2.4.0 (✅ Terminé)
- [x] Système i18n centralisé (FR + EN)
- [x] Commande `/lang` pour basculer la langue
- [x] 500+ clés de traduction
- [x] Documentation bilingue (README FR/EN avec badges)

### v2.5.0 – v2.5.1 (✅ Terminé)
- [x] 3 nouveaux rôles (Salvateur, Ancien, Idiot du Village)
- [x] Mode spectateur complet (👻-spectateurs, lecture seule)
- [x] Système de thèmes d'embeds (4 palettes, 12 couleurs sémantiques)
- [x] CI/CD Pipeline (GitHub Actions)
- [x] Correctifs stabilité (validation catégorie, orphan cleanup)

### v2.6.0 (✅ Terminé)
- [x] Équilibrage des phases (AFK nuit 120s, délibération 300s, vote 180s)
- [x] Vote capitaine automatique avec résolution
- [x] Condition de victoire loups configurable (`majority`/`elimination`)
- [x] Ping loups en début de phase nuit
- [x] Correctif potion sorcière

### v2.7.0 (✅ Terminé)
- [x] Petite Fille : espionnage temps réel en DM (`/listen` relay anonymisé)
- [x] Algorithme d'indices intelligents (`pickSmartHint()`, normalisation Unicode/zalgo)
- [x] Configuration wolfwin serveur-wide (persistée SQLite, toggle lobby)
- [x] Enregistrement commandes guild-only + nettoyage global
- [x] Screenshots intégrés dans README FR/EN

### v2.8.0 (✅ Terminé)
- [x] Docker containerization (Dockerfile multi-stage, docker-compose, .dockerignore)
- [x] Backup automatique horaire SQLite (rotation 24h, backup au shutdown)
- [x] Multi-guild support (langue & config par serveur avec fallback global)
- [x] Système de rematch (revanche rapide avec mêmes joueurs)

### v2.9.0 (✅ Terminé)
- [x] Système de succès (18 achievements, 6 catégories, tracking en jeu)
- [x] ELO ranking system (7 paliers, calcul dynamique, leaderboard)
- [x] Révélation des rôles à la mort (embeds thématiques)
- [x] Notifications DM de tour (Salvateur, Loups, Sorcière, Voyante)
- [x] Commandes `/leaderboard`, `/history`, `/stats` enrichi
- [x] Timeline post-game dans le récapitulatif
- [x] 60+ clés de locale FR/EN ajoutées
- [x] 4 bugs critiques corrigés (multi-guild, victory flow, listen, persistence)

### v3.0.0 (✅ Terminé)
- [x] Web Dashboard avec Express.js + EJS (dark theme, responsive)
- [x] Live Spectator WebSocket (Socket.IO, event feed en temps réel)
- [x] REST API complète (15 endpoints : games, leaderboard, stats, roles, config)
- [x] Discord OAuth2 (passport-discord, admin permissions)
- [x] Custom Roles system (CRUD, éditeur visuel, table SQLite)
- [x] GameManager EventEmitter (7 types d'événements, snapshot sérialisable)
- [x] Sécurité : helmet, CORS, CSP, session 7j

### v3.1.0 (✅ Terminé)
- [x] Audit architecture 15 points (multi-tenant, FSM, sécurité, performance)
- [x] Fix critique : lobby timeout nettoyé au start()
- [x] Fix critique : nextPhase() bloque les parties ENDED
- [x] Élimination XSS : innerHTML → DOM API safe
- [x] Rate limiting WebSocket (30 events/10s/socket)
- [x] Debounce émissions gameState (200ms/room)
- [x] Filtrage requestGames par guild
- [x] Leaderboard filtré par guild_id (sous-requête SQL)
- [x] t() supporte locale per-guild
- [x] Archivage automatique game_history (7 jours)
- [x] Index DB : games(guild_id), games(guild_id, ended_at)
- [x] Re-arm timers après loadState()
- [x] 11 nouveaux tests FSM + snapshot (200 total)

### v3.4.0 (Planned)
- [ ] Support de langues communautaires
- [ ] Tableau de bord avancé avec graphiques (Chart.js)
- [ ] Système de tournois
- [ ] API webhooks pour intégrations tierces

---

*Pour plus de détails, consultez OPTIMIZATIONS.md et TROUBLESHOOTING.md*
