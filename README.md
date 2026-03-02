# 🐺 Werewolf Discord Bot

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Français](https://img.shields.io/badge/lang-Français-red)](README.fr.md)

A Discord bot for playing **Werewolf (Mafia)** with automatic voice management, ambient audio, web dashboard and interactive lobby.

![Version](https://img.shields.io/badge/version-3.5.2-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)
![Tests](https://img.shields.io/badge/tests-1245%20passed-brightgreen)

---

## Table of Contents

- [Screenshots](#-screenshots)
- [Features](#-features)
- [Game Flow](#-game-flow)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Commands](#-commands)
- [How to Play](#-how-to-play)
- [Tests](#-tests)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [Roadmap](#-roadmap)

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center"><b>Interactive Lobby</b></td>
    <td align="center"><b>Role Distribution (DM)</b></td>
  </tr>
  <tr>
    <td><a href="https://ibb.co/SCybtk7"><img src="https://i.ibb.co/SCybtk7/lobby.png" alt="Interactive Lobby" width="400"/></a></td>
    <td><a href="https://ibb.co/CKFXhDf2"><img src="https://i.ibb.co/CKFXhDf2/role-dm.png" alt="Role Distribution in DM" width="400"/></a></td>
  </tr>
  <tr>
    <td align="center"><b>Game Channels</b></td>
    <td align="center"><b>Night Phase — Village Channel</b></td>
  </tr>
  <tr>
    <td><a href="https://ibb.co/5Xd2zRqJ"><img src="https://i.ibb.co/5Xd2zRqJ/channels.png" alt="Game Channels" width="400"/></a></td>
    <td><a href="https://ibb.co/BHG2cLzZ"><img src="https://i.ibb.co/BHG2cLzZ/night-phase.png" alt="Night Phase" width="400"/></a></td>
  </tr>
</table>

---

## ✨ Features

### 🎮 Gameplay
- **Interactive lobby** — Join / Leave / Start buttons with real-time role preview
- **12 roles** — Werewolf, White Wolf, Villager, Seer, Witch, Hunter, Little Girl, Cupid, Salvateur, Ancien, Idiot du Village, Thief
- **Automatic phases** — Night / Day cycle with voice mute/unmute, FSM-validated transitions
- **Merged day vote** — Discussion and vote run simultaneously (8 min), with modifiable votes and absolute majority early resolution
- **Captain election** — Automatic vote (×2 voting power), tie-breaking by random draw
- **Victory detection** — Village, Wolves (majority or elimination, configurable), Lovers, Draw
- **Ambient audio** — Night, day, death and victory sounds in voice channel
- **Spectator mode** — Dead players get read-only access to all channels + dedicated spectator channel
- **DM notifications** — Players receive a DM when it's their role's turn at night

### 🏆 Progression & Rankings
- **18 achievements** across 6 categories with emoji badges
- **ELO ranking** — 7 tiers: Iron → Bronze → Silver → Gold → Platinum → Diamond → Alpha Wolf
- **`/leaderboard`**, **`/history`**, **`/stats`** — Full player profiles with ELO, rank, win streaks, role stats
- **Post-game summary** — ELO changes, event timeline, achievement unlocks

### 🌐 Web Dashboard & API
- **Web dashboard** — Command center UI with PJAX navigation, animated counters, real-time data
- **Live spectator** — Watch games via Socket.IO (player list, vote chart, event feed)
- **REST API** — 20+ endpoints for games, leaderboard, stats, roles, config, moderation
- **Discord OAuth2** — Login with Discord, per-guild admin features
- **Guild management** — Overview, leaderboard, history, moderation, rules configuration
- **Roles encyclopedia** — Browse all roles with descriptions and camp filters

### ⚙️ Administration
- **`/setup wizard`** — One-click auto-setup or category selection
- **Customizable rules** — Min/max players, wolf win condition
- **Debug commands** — Fake players, force start, inspect game state
- **Auto cleanup** — Inactive game channels and lobbies (1h)
- **Rate limiting** — Token bucket anti-spam with automatic bans
- **Monitoring** — Real-time dashboard, webhook alerts, Prometheus metrics

### 🌍 Internationalization
- **FR / EN** — `/lang` command to switch language, saved in database
- **500+ translation keys** — All messages, embeds, buttons and alerts
- **Extensible** — Add a language by creating `locales/xx.js`

### 🗄️ Technical
- **SQLite persistence** — Game state, player stats, ELO, achievements, metrics
- **GameMutex** — Async lock per game preventing race conditions
- **FSM transition table** — Validates all phase transitions, logs invalid paths
- **Transaction-wrapped sync** — Atomic DB writes, no partial state on crash
- **GUI_MASTER architecture** — Single persistent panel per channel, edit-only updates (zero message spam)
- **Docker ready** — Multi-stage build, docker-compose with persistent volumes, health checks
- **Auto backup** — Hourly SQLite backups with 24h rotation
- **1245 automated tests** — 43 suites, 0 failures

---

## 🎯 Game Flow

```
┌─────────────────────────────────────────────────────────┐
│                        NIGHT                            │
│  Thief → Cupid → Salvateur → Wolves → White Wolf →     │
│  Witch → Seer → Dawn                                   │
│  (each role: 120s AFK timeout)                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                         DAY                             │
│  ┌──────────────────────────────────────────────┐       │
│  │ Captain Election (if needed) — 120s           │       │
│  │ Auto-resolves when all voted or on timeout    │       │
│  └───────────────────────┬──────────────────────┘       │
│                          ▼                              │
│  ┌──────────────────────────────────────────────┐       │
│  │ Debate & Vote (merged) — 8 min                │       │
│  │ • Discussion opens immediately                │       │
│  │ • Votes can be changed until timer expires    │       │
│  │ • Early end: absolute majority reached        │       │
│  │ • Early end: all alive players have voted     │       │
│  └───────────────────────┬──────────────────────┘       │
│                          ▼                              │
│  Captain tiebreak (if tied) → Elimination → Night       │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js                 # Entry point, Discord event handlers
├── commands/                # 35 slash commands (auto-loaded)
├── game/
│   ├── gameManager.js       # Game engine (phases, victory, EventEmitter)
│   ├── GameMutex.js         # Async per-game lock
│   ├── achievements.js      # Achievement engine + ELO system
│   ├── voiceManager.js      # Audio & voice connections
│   ├── phases.js            # Phase constants + FSM transition table
│   ├── roles.js             # Role constants (12 roles)
│   ├── guildReconciler.js   # Auto-purge stale guild data
│   └── abilities/           # Composable ability engine (custom roles)
├── web/
│   ├── server.js            # Express + Socket.IO server
│   ├── routes/              # Auth, API, dashboard routes
│   ├── views/               # EJS templates (15+ pages)
│   └── public/              # Static assets (CSS, JS, locales)
├── locales/                 # FR + EN translations (~500+ keys each)
├── utils/                   # Config, i18n, logger, rate limiter, validators
├── database/                # SQLite API + schema + backup
├── monitoring/              # Metrics collector + webhook alerts
├── tests/                   # 1245 Jest tests across 43 suites
├── audio/                   # Ambient sounds (.mp3)
├── img/                     # Role images
├── Dockerfile               # Multi-stage Docker build
└── docker-compose.yml       # Production-ready compose
```

### Key Design Decisions

| Concern | Solution |
|---------|----------|
| Race conditions | `GameMutex` — async promise-chaining lock per game |
| State integrity | FSM transition table + `_setSubPhase()` single entry point |
| Crash safety | Transaction-wrapped DB sync + dirty flag + timer re-arm on boot |
| Message spam | GUI_MASTER — one persistent embed per channel, edit-only |
| Multi-guild | Per-server language, config, category with global fallback |
| Observability | Structured logger, Prometheus `/api/metrics`, webhook alerts |

---

## 🚀 Installation

### 🐳 Docker (Recommended)

```bash
git clone https://github.com/user/Werewolf-bot.git
cd Werewolf-bot
cp .env.example .env    # Edit with your tokens
```

`.env` configuration:
```env
TOKEN=your_discord_bot_token
CLIENT_ID=discord_application_id
GUILD_ID=discord_server_id
LOG_LEVEL=INFO

# Web Dashboard (optional)
WEB_PORT=3000
CLIENT_SECRET=your_discord_oauth2_secret
SESSION_SECRET=your_session_secret
```

```bash
docker compose up -d
```

> Docker provides: auto-restart, persistent volumes (database + logs), health checks, log rotation, FFmpeg included.
> Web dashboard starts automatically on port 3000.

<details>
<summary><b>Useful Docker commands</b></summary>

```bash
docker compose logs -f           # Follow logs
docker compose restart           # Restart
docker compose down              # Stop
docker compose up -d --build     # Rebuild after update
```
</details>

### 📦 Manual (Node.js)

<details>
<summary><b>Install without Docker</b></summary>

**Prerequisites:** Node.js ≥ 20, FFmpeg (optional, for audio)

```bash
git clone https://github.com/user/Werewolf-bot.git
cd Werewolf-bot
npm install
cp .env.example .env    # Edit with your tokens
npm start
```
</details>

### Discord Setup

```
/setup wizard          # Interactive setup (recommended)
```

> The bot refuses to create games without a configured category.

---

## 📋 Commands

### Players

| Command | Description |
|---------|-------------|
| `/create` | Create a game (interactive lobby) |
| `/join` | Join the current game |
| `/help` | Display command list |

### In-Game

| Command | Description | Role |
|---------|-------------|------|
| `/kill @player` | Choose the night victim | 🐺 Werewolves |
| `/see @player` | Reveal a player's role | 🔮 Seer |
| `/potion Life\|Death` | Use a potion | 🧪 Witch |
| `/love @a @b` | Link two lovers | 💘 Cupid |
| `/protect @player` | Protect a player | 🛡️ Salvateur |
| `/shoot @player` | Shoot on death | 🏹 Hunter |
| `/listen` | Spy on wolves (DM relay, 30% detection) | 👧 Little Girl |
| `/steal` | Choose an extra role | 🎭 Thief |
| `/skip` | Skip your night action | Night roles |
| `/vote @player` | Vote to eliminate | All (alive) |
| `/captainvote @player` | Vote for captain | All (alive) |
| `/nextphase` | Advance to next phase | All |
| `/vote-end` | Vote to stop the game | All (alive) |
| `/end` | End the game | Admin / Host |

### Progression

| Command | Description |
|---------|-------------|
| `/stats [@player]` | Player stats (ELO, rank, achievements) |
| `/leaderboard [top]` | Server ELO leaderboard |
| `/history [limit]` | Recent game history |

### Administration

| Command | Description |
|---------|-------------|
| `/setup wizard` | Configuration wizard |
| `/setrules` | Min/max players, wolf win condition |
| `/clear` | Clean up game channels |
| `/force-end` | Force end a game |
| `/lang fr\|en` | Change bot language |
| `/theme` | Change embed color theme |
| `/monitoring` | Real-time metrics & health |
| `/ratelimit stats` | Anti-spam stats |

---

## 🎮 How to Play

1. **Create** — `/create` in the configured category
2. **Join** — Click the **Join** button on the lobby embed
3. **Start** — Host clicks **Start** when enough players are ready
4. **Roles** — Each player receives their role via DM
5. **Night** — Each role acts in their private channel (120s max)
6. **Day** — The village debates and votes to eliminate a suspect (8 min)
7. **Victory** — When a side wins, the summary is displayed with ELO changes

---

## 🧪 Tests

```bash
npm test                 # Run all 1245 tests
npm run test:coverage    # With coverage report
npm run test:watch       # Watch mode
```

See [TESTING.md](TESTING.md) for the full testing guide.

---

## 📚 Documentation

| Document | Content |
|----------|---------|
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [CONFIG.md](CONFIG.md) | Configuration system |
| [DATABASE.md](DATABASE.md) | SQLite schema & API |
| [LOGGING.md](LOGGING.md) | Logging system |
| [MONITORING.md](MONITORING.md) | Monitoring & alerts |
| [RATE_LIMITING.md](RATE_LIMITING.md) | Anti-spam protection |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Troubleshooting guide |
| [TESTING.md](TESTING.md) | Testing guide |

---

## 🤝 Contributing

1. Fork the project
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit with conventional commits (`feat:`, `fix:`, `refactor:`)
4. Push and open a Pull Request

### Code Standards
- All user-facing strings use `t()` (i18n)
- All phase transitions go through `_setSubPhase()`
- All concurrent game mutations use `runAtomic()`
- All new features require tests

---

## 🔮 Roadmap

| Version | Focus |
|---------|-------|
| **3.6** | GUI actions (buttons/menus replacing slash commands in-game), mobile-responsive web |
| **3.7** | Seasons, tournaments, cross-guild rankings |
| **4.0** | AI balancing, new game modes, additional localizations (ES, DE, PT) |

---

**Version**: 3.5.2 · **Node.js**: ≥ 20 · **Discord.js**: v14 · **License**: ISC
