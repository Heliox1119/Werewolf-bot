# 🐺 Werewolf Discord Bot

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Français](https://img.shields.io/badge/lang-Français-red)](README.fr.md)

Un bot Discord pour jouer au **Loup-Garou de Thiercelieux** avec gestion vocale automatique, audio d'ambiance, tableau de bord web et lobby interactif.

![Version](https://img.shields.io/badge/version-3.5.4-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)
![Tests](https://img.shields.io/badge/tests-1380%20passed-brightgreen)

---

## Table des matières

- [Captures d'écran](#-captures-décran)
- [Fonctionnalités](#-fonctionnalités)
- [Déroulement d'une partie](#-déroulement-dune-partie)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Commandes](#-commandes)
- [Comment jouer](#-comment-jouer)
- [Tests](#-tests)
- [Documentation](#-documentation)
- [Contribution](#-contribution)
- [Roadmap](#-roadmap)

---

## 📸 Captures d'écran

<table>
  <tr>
    <td align="center"><b>Lobby interactif</b></td>
    <td align="center"><b>Distribution des rôles (DM)</b></td>
  </tr>
  <tr>
    <td><a href="https://ibb.co/SCybtk7"><img src="https://i.ibb.co/SCybtk7/lobby.png" alt="Lobby interactif" width="400"/></a></td>
    <td><a href="https://ibb.co/CKFXhDf2"><img src="https://i.ibb.co/CKFXhDf2/role-dm.png" alt="Distribution des rôles en DM" width="400"/></a></td>
  </tr>
  <tr>
    <td align="center"><b>Channels de jeu</b></td>
    <td align="center"><b>Phase de nuit — Salon Village</b></td>
  </tr>
  <tr>
    <td><a href="https://ibb.co/5Xd2zRqJ"><img src="https://i.ibb.co/5Xd2zRqJ/channels.png" alt="Channels de jeu" width="400"/></a></td>
    <td><a href="https://ibb.co/BHG2cLzZ"><img src="https://i.ibb.co/BHG2cLzZ/night-phase.png" alt="Phase de nuit" width="400"/></a></td>
  </tr>
</table>

---

## ✨ Fonctionnalités

### 🎮 Gameplay
- **Lobby interactif** — Boutons Rejoindre / Quitter / Démarrer avec barre de progression Unicode, liste compacte, aperçu des rôles en temps réel
- **12 rôles** — Loup-Garou, Loup Blanc, Villageois, Voyante, Sorcière, Chasseur, Petite Fille, Cupidon, Salvateur, Ancien, Idiot du Village, Voleur
- **Phases automatiques** — Alternance Nuit / Jour avec mute/unmute vocal, transitions validées par FSM
- **Vote de jour fusionné** — Discussion et vote simultanés (8 min), votes modifiables, résolution anticipée à la majorité absolue
- **Élection du capitaine** — Vote automatique (vote ×2), égalité départagée au sort
- **Détection de victoire** — Village, Loups (majorité ou élimination, configurable), Amoureux, Égalité
- **Audio d'ambiance** — Sons de nuit, jour, mort et victoire dans le vocal
- **Narration dynamique** — Textes atmosphériques contextuels par phase (tons nuit/jour : calme, tendu, critique)
- **Mode spectateur** — Les joueurs morts voient tous les salons en lecture seule + salon spectateur dédié
- **Notifications DM** — Les joueurs reçoivent un DM quand c'est le tour de leur rôle la nuit

### 🏆 Progression & Classement
- **18 succès** répartis en 6 catégories avec badges emoji
- **Classement ELO** — 7 paliers : Fer → Bronze → Argent → Or → Platine → Diamant → Loup Alpha
- **`/leaderboard`**, **`/history`**, **`/stats`** — Profils complets avec ELO, rang, séries de victoires, stats par rôle
- **Récapitulatif post-game** — Changements ELO, timeline, succès débloqués

### 🌐 Tableau de bord web & API
- **Tableau de bord** — Interface centre de commandes avec navigation PJAX, compteurs animés, données temps réel
- **Spectateur live** — Suivez les parties via Socket.IO (liste joueurs, graphique votes, flux d'événements)
- **API REST** — 20+ endpoints (parties, classement, stats, rôles, config, modération)
- **Discord OAuth2** — Connexion Discord, fonctionnalités admin par serveur
- **Gestion de guilde** — Vue d'ensemble, classement, historique, modération, configuration des règles
- **Encyclopédie des rôles** — Parcourez tous les rôles avec descriptions et filtres par camp

### ⚙️ Administration
- **`/setup wizard`** — Auto-setup en un clic ou sélection de catégorie
- **Règles personnalisables** — Min/max joueurs, condition de victoire des loups
- **Commandes debug** — Joueurs fictifs, forcer un démarrage, inspecter l'état
- **Nettoyage automatique** — Channels de jeu suivis en DB, expiration du lobby avec notification stylée
- **Rate limiting** — Token bucket anti-spam avec bans automatiques
- **Monitoring** — Dashboard temps réel, alertes webhook, métriques Prometheus
- **Résilience réseau** — Filtrage des erreurs transitoires, gestionnaires d'erreurs vocaux

### 🌍 Internationalisation
- **FR / EN** — Commande `/lang` pour basculer la langue, sauvegardée en base
- **500+ clés de traduction** — Tous les messages, embeds, boutons et alertes
- **Extensible** — Ajouter une langue = créer `locales/xx.js`

### 🗄️ Technique
- **Persistance SQLite** — État des parties, stats joueurs, ELO, succès, métriques, suivi des channels de jeu
- **GameMutex** — Verrou asynchrone par partie empêchant les race conditions
- **Table FSM de transitions** — Valide toutes les transitions de phases, log les chemins invalides
- **Sync transactionnelle** — Écritures DB atomiques, pas d'état partiel en cas de crash
- **Architecture GUI_MASTER** — Un seul panel persistant par channel, mises à jour par edit uniquement (zéro spam de messages)
- **Docker ready** — Build multi-stage, docker-compose avec volumes persistants, health checks
- **Backup automatique** — Backup SQLite horaire avec rotation 24h
- **1380 tests automatisés** — 47 suites, 0 failures

---

## 🎯 Déroulement d'une partie

```
┌─────────────────────────────────────────────────────────┐
│                        NUIT                             │
│  Voleur → Cupidon → Salvateur → Loups → Loup Blanc →   │
│  Sorcière → Voyante → Réveil                           │
│  (chaque rôle : timeout AFK 120s)                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                        JOUR                             │
│  ┌──────────────────────────────────────────────┐       │
│  │ Élection du capitaine (si nécessaire) — 120s  │       │
│  │ Résolution auto quand tous ont voté ou timeout│       │
│  └───────────────────────┬──────────────────────┘       │
│                          ▼                              │
│  ┌──────────────────────────────────────────────┐       │
│  │ Débat & Vote (fusionnés) — 8 min              │       │
│  │ • La discussion s'ouvre immédiatement          │       │
│  │ • Les votes sont modifiables jusqu'à la fin    │       │
│  │ • Fin anticipée : majorité absolue atteinte    │       │
│  │ • Fin anticipée : tous les vivants ont voté    │       │
│  └───────────────────────┬──────────────────────┘       │
│                          ▼                              │
│  Départage capitaine (si égalité) → Élimination → Nuit  │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js                 # Point d'entrée, handlers Discord
├── commands/                # 35 commandes slash (auto-chargées)
├── game/
│   ├── gameManager.js       # Moteur de jeu (phases, victoire, EventEmitter)
│   ├── GameMutex.js         # Verrou asynchrone par partie
│   ├── achievements.js      # Moteur de succès + système ELO
│   ├── voiceManager.js      # Audio & connexions vocales
│   ├── phases.js            # Constantes de phases + table FSM
│   ├── narrationPools.js     # Narration dynamique de phases (tons nuit/jour)
│   ├── roles.js             # Constantes de rôles (12 rôles)
│   ├── guildReconciler.js   # Purge auto des guildes obsolètes
│   └── abilities/           # Moteur d'abilities composable (rôles custom)
├── web/
│   ├── server.js            # Serveur Express + Socket.IO
│   ├── routes/              # Auth, API, dashboard
│   ├── views/               # Templates EJS (15+ pages)
│   └── public/              # Assets statiques (CSS, JS, locales)
├── locales/                 # Traductions FR + EN (~500+ clés chacune)
├── utils/                   # Config, i18n, logger, rate limiter, validators
├── database/                # API SQLite + schéma + backup
├── monitoring/              # Collecteur de métriques + alertes webhook
├── tests/                   # 1380 tests Jest sur 47 suites
├── audio/                   # Sons d'ambiance (.mp3)
├── img/                     # Images des rôles
├── Dockerfile               # Build Docker multi-stage
└── docker-compose.yml       # Compose production-ready
```

### Choix d'architecture clés

| Problème | Solution |
|----------|----------|
| Race conditions | `GameMutex` — verrou par promesses chaînées par partie |
| Intégrité d'état | Table FSM de transitions + `_setSubPhase()` point d'entrée unique |
| Sécurité crash | Sync DB transactionnelle + dirty flag + ré-armement timers au boot |
| Spam de messages | GUI_MASTER — un embed persistant par channel, edit uniquement |
| Multi-guild | Langue, config, catégorie par serveur avec fallback global |
| Nettoyage channels | Table `game_channels` en DB — zéro matching heuristique |
| Observabilité | Logger structuré, Prometheus `/api/metrics`, alertes webhook |

---

## 🚀 Installation

### 🐳 Docker (Recommandé)

```bash
git clone https://github.com/user/Werewolf-bot.git
cd Werewolf-bot
cp .env.example .env    # Éditer avec vos tokens
```

Configuration `.env` :
```env
TOKEN=votre_token_bot_discord
CLIENT_ID=id_application_discord
GUILD_ID=id_serveur_discord
LOG_LEVEL=INFO

# Tableau de bord web (optionnel)
WEB_PORT=3000
CLIENT_SECRET=votre_secret_oauth2_discord
SESSION_SECRET=votre_secret_de_session
```

```bash
docker compose up -d
```

> Docker fournit : auto-restart, volumes persistants (base de données + logs), health checks, rotation des logs, FFmpeg inclus.
> Le tableau de bord web démarre automatiquement sur le port 3000.

<details>
<summary><b>Commandes Docker utiles</b></summary>

```bash
docker compose logs -f           # Suivre les logs
docker compose restart           # Redémarrer
docker compose down              # Arrêter
docker compose up -d --build     # Reconstruire après mise à jour
```
</details>

### 📦 Manuel (Node.js)

<details>
<summary><b>Installation sans Docker</b></summary>

**Prérequis :** Node.js ≥ 20, FFmpeg (optionnel, pour l'audio)

```bash
git clone https://github.com/user/Werewolf-bot.git
cd Werewolf-bot
npm install
cp .env.example .env    # Éditer avec vos tokens
npm start
```
</details>

### Configuration Discord

```
/setup wizard          # Assistant interactif (recommandé)
```

> Le bot refuse de créer des parties sans catégorie configurée.

---

## 📋 Commandes

### Joueurs

| Commande | Description |
|----------|-------------|
| `/create` | Créer une partie (lobby interactif) |
| `/join` | Rejoindre la partie en cours |
| `/help` | Afficher la liste des commandes |

### En jeu

| Commande | Description | Rôle |
|----------|-------------|------|
| `/kill @joueur` | Désigner la victime de la nuit | 🐺 Loups-Garous |
| `/see @joueur` | Découvrir le rôle d'un joueur | 🔮 Voyante |
| `/potion Vie\|Mort` | Utiliser une potion | 🧪 Sorcière |
| `/love @a @b` | Lier deux amoureux | 💘 Cupidon |
| `/protect @joueur` | Protéger un joueur | 🛡️ Salvateur |
| `/shoot @joueur` | Tirer en mourant | 🏹 Chasseur |
| `/listen` | Espionner les loups (relay DM, 30% détection) | 👧 Petite Fille |
| `/steal` | Choisir un rôle supplémentaire | 🎭 Voleur |
| `/skip` | Passer son action de nuit | Rôles de nuit |
| `/vote @joueur` | Voter pour éliminer | Tous (vivants) |
| `/captainvote @joueur` | Voter pour le capitaine | Tous (vivants) |
| `/nextphase` | Avancer à la phase suivante | Tous |
| `/vote-end` | Voter pour arrêter la partie | Tous (vivants) |
| `/end` | Terminer la partie | Admin / Host |

### Progression

| Commande | Description |
|----------|-------------|
| `/stats [@joueur]` | Stats du joueur (ELO, rang, succès) |
| `/leaderboard [top]` | Classement ELO du serveur |
| `/history [limit]` | Historique des dernières parties |

### Administration

| Commande | Description |
|----------|-------------|
| `/setup wizard` | Assistant de configuration |
| `/setrules` | Min/max joueurs, condition de victoire |
| `/clear` | Nettoyer les channels de jeu |
| `/force-end` | Terminer une partie de force |
| `/lang fr\|en` | Changer la langue du bot |
| `/theme` | Changer le thème des embeds |
| `/monitoring` | Métriques temps réel & santé |
| `/ratelimit stats` | Stats anti-spam |

---

## 🎮 Comment jouer

1. **Créer** — `/create` dans la catégorie configurée
2. **Rejoindre** — Cliquer sur le bouton **Rejoindre** du lobby
3. **Démarrer** — L'hôte clique sur **Démarrer** quand il y a assez de joueurs
4. **Rôles** — Chaque joueur reçoit son rôle en DM
5. **Nuit** — Chaque rôle agit dans son salon privé (120s max)
6. **Jour** — Le village débat et vote pour éliminer un suspect (8 min)
7. **Victoire** — Quand un camp gagne, le récapitulatif s'affiche avec les changements ELO

---

## 🧪 Tests

```bash
npm test                 # Lancer les 1380 tests
npm run test:coverage    # Avec rapport de couverture
npm run test:watch       # Mode watch
```

Voir [TESTING.md](TESTING.md) pour le guide complet.

---

## 📚 Documentation

| Document | Contenu |
|----------|---------|
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |
| [CONFIG.md](CONFIG.md) | Système de configuration |
| [DATABASE.md](DATABASE.md) | Schéma SQLite & API |
| [LOGGING.md](LOGGING.md) | Système de logging |
| [MONITORING.md](MONITORING.md) | Monitoring & alertes |
| [RATE_LIMITING.md](RATE_LIMITING.md) | Protection anti-spam |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Guide de dépannage |
| [TESTING.md](TESTING.md) | Guide des tests |

---

## 🤝 Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/ma-feature`)
3. Commit avec conventional commits (`feat:`, `fix:`, `refactor:`)
4. Push et ouvrir une Pull Request

### Standards de code
- Tous les textes utilisateur utilisent `t()` (i18n)
- Toutes les transitions de phase passent par `_setSubPhase()`
- Toutes les mutations concurrentes utilisent `runAtomic()`
- Toute nouvelle fonctionnalité nécessite des tests

---

## 🔮 Roadmap

| Version | Focus |
|---------|-------|
| **3.6** | Actions GUI (boutons/menus remplaçant les commandes slash en jeu), web responsive mobile |
| **3.7** | Saisons, tournois, classements cross-guild |
| **4.0** | Équilibrage IA, nouveaux modes de jeu, localisations supplémentaires (ES, DE, PT) |

---

**Version** : 3.5.4 · **Node.js** : ≥ 20 · **Discord.js** : v14 · **License** : ISC
