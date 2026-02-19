# 🐺 Werewolf Discord Bot

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Français](https://img.shields.io/badge/lang-Français-red)](README.fr.md)

A full-featured Discord bot to play **Werewolf (Mafia)** with automatic voice management, ambient audio and interactive lobby.

![Version](https://img.shields.io/badge/version-2.7.0-blue)
![CI](https://github.com/Heliox1119/Werewolf-bot/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2016.9.0-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![Tests](https://img.shields.io/badge/tests-191%20passed-brightgreen)

---

## ✨ Features

### 🎮 Gameplay
- **Interactive lobby** — Join / Leave / Start buttons with real-time role preview
- **10 roles** — Werewolf, Villager, Seer, Witch, Hunter, Little Girl, Cupid, Salvateur, Ancien, Idiot du Village
- **Automatic phases** — Night / Day cycle with automatic voice mute/unmute
- **Voting system** — Village vote, automatic captain election (×2 vote), tie-breaking
- **Victory detection** — Village, Wolves (majority or elimination, configurable), Lovers, Draw
- **Ambient audio** — Night, day, death and victory sounds in voice channel
- **Spectator mode** — Dead players can see all channels in read-only, dedicated spectator channel

### ⚙️ Administration
- **Setup via commands** — `/setup wizard` for guided configuration
- **Customizable rules** — Adjustable min/max players
- **Debug commands** — Fake players, force start, inspect game state
- **Auto cleanup** — Inactive game channels and lobbies (1h)
- **Rate limiting** — Anti-spam protection with automatic bans
- **Monitoring** — Real-time dashboard, webhook alerts, 24h history

### 🌍 Internationalization
- **Multilingual FR / EN** — `/lang` command to switch bot language
- **500+ translation keys** — All messages, embeds, buttons and alerts translated
- **Persistence** — Chosen language is saved in database
- **Extensible** — Adding a language = creating a `locales/xx.js` file

### 🗄️ Technical
- **SQLite persistence** — Game state, player stats, night actions, metrics
- **Centralized i18n** — `I18n` singleton, `{{variable}}` interpolation, automatic fallback
- **Robust error handling** — safeReply, graceful shutdown, zero crash in production
- **191 automated tests** — 15 suites, 0 failures
- **Embed themes** — 4 color palettes, `/theme` command, 12 semantic colors

---

## 🚀 Installation

### Prerequisites
- **Node.js** ≥ 16.9.0
- A **Discord bot** with permissions: Manage Channels, Manage Roles, Connect, Speak, Send Messages, Mute Members

### Setup

```bash
# 1. Clone and install
git clone https://github.com/Heliox1119/Werewolf-bot.git
cd Werewolf-bot
npm install

# 2. Configure environment
cp .env.example .env   # or create manually
```

Fill in the `.env` file:
```env
TOKEN=your_discord_bot_token
CLIENT_ID=discord_application_id
GUILD_ID=discord_server_id
LOG_LEVEL=INFO    # DEBUG | INFO | WARN | ERROR | NONE
```

```bash
# 3. Add audio files (optional)
mkdir audio
# Place: night_ambience.mp3, day_ambience.mp3, death.mp3,
#        victory_villagers.mp3, victory_wolves.mp3

# 4. Start the bot
npm start
```

### Discord Configuration

Once the bot is online, in Discord:
```
/setup wizard          # Interactive wizard (recommended)
# or manually:
/setup category #my-category
/setup status          # Check configuration
```

> ⚠️ The bot will refuse to create games without a configured category.

---

## 📋 Commands

### Players

| Command | Description |
|---------|-------------|
| `/create` | Create a game (interactive lobby) |
| `/join` | Join the game |
| `/help` | Display command help |

### In-game

| Command | Description | Role |
|---------|-------------|------|
| `/kill @player` | Choose the night victim | 🐺 Werewolves |
| `/see @player` | Reveal a player's role | 🔮 Seer |
| `/potion type:Life/Death` | Use a potion | 🧪 Witch |
| `/love @a @b` | Link two lovers | 💘 Cupid |
| `/shoot @player` | Shoot on death | 🏹 Hunter |
| `/listen` | Real-time anonymized spy on wolves (DM relay, 30% detection with smart hint) | 👧 Little Girl |
| `/skip` | Skip your night action | Seer / Witch / Cupid |
| `/vote @player` | Vote to eliminate someone | All (alive) |
| `/captainvote @player` | Vote for captain (auto-resolve) | All (alive) |
| `/nextphase` | Advance to next phase | All |
| `/vote-end` | Vote to stop the game | All (alive) |
| `/end` | End the game | Admin / Host |

### Administration

| Command | Description |
|---------|-------------|
| `/setup wizard` | Configuration wizard |
| `/setup category` | Set Discord category |
| `/setup rules min max` | Default rules (players) |
| `/setup webhook url` | Monitoring webhook |
| `/setup status` | View configuration |
| `/setrules` | Change min/max players, wolf win condition (`majority`/`elimination`) |
| `/clear` | Clean up game channels |
| `/force-end` | Force end a game (bypass) |
| `/lang fr\|en` | Change the bot language |
| `/monitoring dashboard` | Real-time metrics |
| `/monitoring health` | Bot health |
| `/ratelimit stats` | Anti-spam stats |

### Debug (Admin only)

| Command | Description |
|---------|-------------|
| `/debug-fake-join` | Add fake players |
| `/debug-start-force` | Force start |
| `/debug-set-role` | Change a player's role |
| `/debug-info` | Game state |
| `/debug-games` | All active games |
| `/debug-reset` | Delete the game |
| `/debug-voicemute` | Disable voice mute |

---

## 🎯 How to Play

1. **Create** — A player types `/create` in the configured category
2. **Join** — Players click the **Join** button on the lobby
3. **Start** — The host clicks **Start** when there are enough players
4. **Night** — Each role acts in their private channel (90s max per role)
5. **Day** — The village discusses and votes to eliminate a suspect
6. **Victory** — When a side wins, the summary is displayed with a restart option

---

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js                # Entry point, Discord handlers
├── commands/               # Slash commands (auto-loaded)
├── game/
│   ├── gameManager.js      # Game logic, phases, victory
│   ├── voiceManager.js     # Audio & voice connections
│   ├── phases.js           # Phase constants
│   └── roles.js            # Role constants
├── locales/
│   ├── fr.js               # French locale (~500+ keys)
│   └── en.js               # English locale (~500+ keys)
├── utils/
│   ├── config.js           # Centralized configuration (SQLite)
│   ├── i18n.js             # i18n system (t(), translateRole/Phase)
│   ├── interaction.js      # safeReply, safeDefer
│   ├── lobbyBuilder.js     # Lobby embed builder
│   ├── rateLimiter.js      # Token bucket anti-spam
│   └── validators.js       # Common validations
├── database/
│   ├── db.js               # SQLite API (games, players, stats)
│   └── schema.sql          # Table schema
├── monitoring/
│   ├── metrics.js          # System/Discord/game collector
│   └── alerts.js           # Webhook alerts
├── tests/                  # 191 Jest tests
├── audio/                  # Ambient sounds (.mp3)
└── img/                    # Role images
```

---

## 🧪 Tests

```bash
npm test                    # Run all tests
npm run health              # Check bot health
npm run clear-commands      # Reset Discord commands
```

---

## 📊 Version History

| Version | Highlights |
|---------|-----------|| **v2.7.0** | Little Girl real-time DM relay, smart ambiguous hints, Unicode/zalgo-proof, wolf win server-wide config, guild-only commands |
| **v2.6.0** | Phase balancing, automatic captain vote, witch potion fix, configurable wolf victory, wolf ping || **v2.5.1** | New roles (Salvateur, Ancien, Idiot), spectator mode, embed themes, bugfixes |
| **v2.4.0** | Centralized i18n system FR/EN, `/lang` command, 500+ translated keys |
| **v2.3.0** | Full audit (47 fixes), spectator mode, `/skip`, player stats in DB |
| **v2.2.1** | Production hardening (26 fixes), 191 tests, safeReply everywhere |
| **v2.2.0** | Secure debug commands, `/shoot`, `/vote-end`, AFK timeout 90s |
| **v2.1.0** | SQLite, rate limiting, monitoring, centralized configuration |
| **v2.0.0** | Debouncing, API cache, optimizations (-650 lines) |

Full details: [CHANGELOG.md](CHANGELOG.md)

---

## 📚 Documentation

| Document | Content |
|----------|---------|
| [CHANGELOG.md](CHANGELOG.md) | Detailed version history |
| [CONFIG.md](CONFIG.md) | Configuration system |
| [DATABASE.md](DATABASE.md) | SQLite architecture, schema, API |
| [MONITORING.md](MONITORING.md) | Monitoring and alerts |
| [RATE_LIMITING.md](RATE_LIMITING.md) | Anti-spam protection |
| [LOGGING.md](LOGGING.md) | Logging system |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Troubleshooting guide |
| [TESTING.md](TESTING.md) | Testing guide |

---

## 🤝 Contributing

1. Fork the project
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit (`git commit -m 'feat: description'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

---

**Version**: 2.7.0 · **Node.js**: ≥ 16.9.0 · **Discord.js**: ^14.25.1 · **License**: ISC
