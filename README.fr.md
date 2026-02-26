# 🐺 Werewolf Discord Bot

[![English](https://img.shields.io/badge/lang-English-blue)](README.md)
[![Français](https://img.shields.io/badge/lang-Français-red)](README.fr.md)

Un bot Discord complet pour jouer au **Loup-Garou de Thiercelieux** avec gestion vocale automatique, audio d'ambiance et lobby interactif.

![Version](https://img.shields.io/badge/version-3.4.1-blue)
![CI](https://github.com/Heliox1119/Werewolf-bot/actions/workflows/ci.yml/badge.svg)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2016.9.0-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)
![Tests](https://img.shields.io/badge/tests-268%20passed-brightgreen)

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
  <tr>
    <td align="center" colspan="2"><b>Logs dans la console</b></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><a href="https://ibb.co/7JZx8X8X"><img src="https://i.ibb.co/7JZx8X8X/console-logs.png" alt="Logs console" width="700"/></a></td>
  </tr>
</table>

> *Cliquez sur une capture pour l'agrandir.*

---

## ✨ Fonctionnalités

### 🎮 Gameplay
- **Lobby interactif** — Boutons Rejoindre / Quitter / Démarrer avec aperçu des rôles en temps réel
- **10 rôles** — Loup-Garou, Villageois, Voyante, Sorcière, Chasseur, Petite Fille, Cupidon, Salvateur, Ancien, Idiot du Village
- **Phases automatiques** — Alternance Nuit / Jour avec mute/unmute vocal automatique
- **Système de votes** — Vote du village, élection du capitaine automatique (vote ×2), égalité départagée par tirage au sort
- **Détection de victoire** — Village, Loups (majorité ou élimination configurable), Amoureux, Égalité
- **Audio d'ambiance** — Sons de nuit, jour, mort et victoire dans le vocal
- **Mode spectateur** — Les joueurs morts voient tous les salons en lecture seule, salon spectateur dédié
- **Révélation à la mort** — Embed thématique avec rôle, cause de mort (loups/village/sorcière/chasseur/amour), code couleur
- **Notification DM de tour** — Les joueurs reçoivent un DM quand c'est le tour de leur rôle la nuit

### 🏆 Progression & Classement
- **18 succès** — 6 catégories (victoire, loup, village, spécial, social, général) avec badges emoji
- **Système ELO** — Calcul dynamique avec 7 paliers : Fer → Bronze → Argent → Or → Platine → Diamant → Loup Alpha
- **`/leaderboard`** — Classement par ELO avec palier, taux de victoire et stats globales
- **`/history`** — Historique des dernières parties avec vainqueur, joueurs, jours, durée
- **`/stats` enrichi** — ELO, rang, peak, victoires loup/village, séries, stats par rôle, badges
- **Récapitulatif post-game** — Changements ELO par joueur, timeline, annonces de succès débloqués

### ⚙️ Administration
- **Configuration par commandes** — `/setup wizard` pour tout configurer
- **Règles personnalisables** — Min/max joueurs ajustables
- **Commandes debug** — Joueurs fictifs, forcer un démarrage, inspecter l'état
- **Nettoyage automatique** — Channels de jeu et lobbys inactifs (1h)
- **Rate limiting** — Protection anti-spam avec ban automatique
- **Monitoring** — Dashboard temps réel, alertes webhook, historique 24h

### 🌍 Internationalisation
- **Multilingue FR / EN** — Commande `/lang` pour basculer la langue du bot
- **500+ clés de traduction** — Tous les messages, embeds, boutons et alertes traduits
- **Persistance** — La langue choisie est sauvegardée en base de données
- **Extensible** — Ajouter une langue = créer un fichier `locales/xx.js`

### 🌐 Web Dashboard & API
- **Interface web redessinée** — UI centre de commandes avec lueur ambiante globale, compteurs animés, navigation PJAX type SPA
- **Éclairage ambiant global** — Couche de lueur unique couvrant tout le viewport, palette assombrie pour un contraste optimal
- **Sidebar style Discord** — Double sidebar : barre d'icônes serveur + panneau de gestion du serveur
- **Panneaux dashboard** — Classement global (top 5) et dernières parties terminées (5 dernières) avec données en direct
- **Mini-jeu « Tirer une carte »** — Deck interactif sur le dashboard avec animations de retournement
- **Deck de cartes invitation** — Deck premium avec animation de mélange, distribution, modale plein écran glassmorphism avec révélation du rôle
- **Redesign page joueur** — Intégration avatar Discord, barres de progression des succès avec icônes cadenas, affichage palier ELO
- **Améliorations spectateur** — Popup profil au clic joueur, persistance du flux d'événements, corrections graphique de votes temps réel
- **Vue d'ensemble serveur** — Graphique de distribution des victoires, top joueurs, parties récentes, métriques animées
- **Classement podium** — Top 3 en cartes visuelles or/argent/bronze, tableau complet triable
- **Encyclopédie des rôles** — Page rôles redessinée avec descriptions détaillées et filtres par camp
- **Page premium** — Redesign cinématique avec particules dorées, paliers de prix, carrousel de rôles, témoignages
- **Wiki documentation** — Wiki intégré complet avec sidebar sticky
- **Page d'invitation landing** — Showcase fonctionnalités, carrousel de rôles, section permissions, animations au scroll
- **Spectateur live** — Layout 3 colonnes avec modale rapide joueur, graphique de votes, flux temps réel
- **API REST** — 20+ endpoints (parties, classement, stats, rôles, config, modération)
- **Discord OAuth2** — Connexion Discord, fonctionnalités admin par serveur, filtrage par niveau d'accès
- **Rôles personnalisés** — Créez et gérez des rôles custom via l'éditeur web
- **Moteur d'abilities composable** — Architecture événementielle pour les capacités de rôles custom

### 🗄️ Technique
- **Persistance SQLite** — État des parties, stats joueurs, actions de nuit, métriques, succès, ELO
- **GameMutex** — Verrou asynchrone par partie empêchant les race conditions sur les transitions de phases
- **Table FSM de transitions** — Machine à états formelle validant toutes les transitions de phases, log des chemins invalides
- **Sync transactionnelle** — Écritures DB atomiques via `db.transaction()`, pas d'état partiel en cas de crash
- **Docker ready** — Dockerfile multi-stage, docker-compose avec volumes persistants, health checks
- **Backup automatique** — Backup SQLite horaire avec rotation 24h, backup au shutdown
- **Multi-guild** — Langue, config et catégorie par serveur avec fallback global
- **Rate limiting API** — `express-rate-limit` (60 req/min API, 15 req/min mod), dédup commandes sur 12 commandes
- **Métriques Prometheus** — `/api/metrics` (uptime, heap, rss, parties actives, joueurs, latence)
- **Endpoint santé** — `/api/health` pour sondes load balancer (200/503)
- **CORS configurable** — Restriction des origines via la variable `CORS_ORIGINS`
- **i18n centralisé** — Singleton `I18n`, interpolation `{{variable}}`, fallback automatique
- **Architecture EventEmitter** — GameManager émet des événements temps réel vers le web
- **Gestion d'erreurs robuste** — safeReply, graceful shutdown, zero crash en production
- **Réconciliation de guildes** — Purge auto des données de serveurs quittés au démarrage
- **Sécurité des permissions bot** — Le bot conserve ViewChannel + ManageChannels sur tous les channels cachés
- **268 tests automatisés** — 23 suites, 0 failures
- **Thèmes d'embed** — 4 palettes de couleurs, commande `/theme`, 12 couleurs sémantiques

---

## 🚀 Installation

### 🐳 Docker (Recommandé)

La manière la plus simple de lancer le bot en production :

```bash
# 1. Cloner le dépôt
git clone https://github.com/Heliox1119/Werewolf-bot.git
cd Werewolf-bot

# 2. Configurer l'environnement
cp .env.example .env   # ou créer manuellement
```

Remplir le fichier `.env` :
```env
TOKEN=votre_token_bot_discord
CLIENT_ID=id_application_discord
GUILD_ID=id_serveur_discord
LOG_LEVEL=INFO    # DEBUG | INFO | WARN | ERROR | NONE

# Web Dashboard (optionnel)
WEB_PORT=3000
CLIENT_SECRET=votre_secret_oauth2_discord
SESSION_SECRET=votre_secret_de_session
```

```bash
# 3. Ajouter les fichiers audio (optionnel)
mkdir -p audio
# Placer : night_ambience.mp3, day_ambience.mp3, death.mp3,
#          victory_villagers.mp3, victory_wolves.mp3

# 4. Lancer avec Docker Compose
docker compose up -d
```

> **Ce que Docker offre :** Auto-restart, volumes persistants pour la base de données et les logs, health checks, rotation des logs, environnement isolé avec FFmpeg inclus.
>
> **Tableau de bord web :** Démarre automatiquement sur le port 3000. Accédez-y à `http://localhost:3000`. Définissez `CLIENT_SECRET` pour la connexion OAuth2.

<details>
<summary><b>Détails Docker</b></summary>

- **Build multi-stage** — Node 20 Alpine, image minimale
- **Volumes persistants** — `werewolf-data` (SQLite + backups), `werewolf-logs`
- **Montage audio** — `./audio` monté en lecture seule dans le conteneur
- **Health check** — Intégré via `scripts/health-check.js` (intervalle 60s)
- **Rotation des logs** — Driver JSON file, 10MB max, 3 fichiers

```bash
# Commandes utiles
docker compose logs -f          # Suivre les logs
docker compose restart           # Redémarrer le bot
docker compose down              # Arrêter le bot
docker compose up -d --build     # Reconstruire après une mise à jour
```

</details>

### 📦 Manuel (Node.js)

<details>
<summary><b>Installation sans Docker</b></summary>

#### Prérequis
- **Node.js** ≥ 16.9.0
- **FFmpeg** (optionnel, pour l'audio d'ambiance)
- Un **bot Discord** avec les permissions : Manage Channels, Manage Roles, Connect, Speak, Send Messages, Mute Members

```bash
# 1. Cloner et installer
git clone https://github.com/Heliox1119/Werewolf-bot.git
cd Werewolf-bot
npm install

# 2. Configurer l'environnement
cp .env.example .env   # ou créer manuellement
```

Remplir le fichier `.env` :
```env
TOKEN=votre_token_bot_discord
CLIENT_ID=id_application_discord
GUILD_ID=id_serveur_discord
LOG_LEVEL=INFO    # DEBUG | INFO | WARN | ERROR | NONE
```

```bash
# 3. Ajouter les fichiers audio (optionnel)
mkdir audio
# Placer : night_ambience.mp3, day_ambience.mp3, death.mp3,
#          victory_villagers.mp3, victory_wolves.mp3

# 4. Lancer le bot
npm start
```

</details>

### Configuration Discord

Une fois le bot en ligne, dans Discord :
```
/setup wizard          # Assistant interactif (recommandé)
# ou manuellement :
/setup category #ma-catégorie
/setup status          # Vérifier la config
```

> ⚠️ Le bot refuse de créer des parties sans catégorie configurée.

---

## 📋 Commandes

### Joueurs

| Commande | Description |
|----------|-------------|
| `/create` | Créer une partie (lobby interactif) |
| `/join` | Rejoindre la partie |
| `/help` | Afficher l'aide des commandes |

### En jeu

| Commande | Description | Rôle |
|----------|-------------|------|
| `/kill @joueur` | Désigner la victime de la nuit | 🐺 Loups-Garous |
| `/see @joueur` | Découvrir le rôle d'un joueur | 🔮 Voyante |
| `/potion type:Vie/Mort` | Utiliser une potion | 🧪 Sorcière |
| `/love @a @b` | Lier deux amoureux | 💘 Cupidon |
| `/shoot @joueur` | Tirer en mourant | 🏹 Chasseur |
| `/listen` | Espionner les loups en temps réel (relay DM anonymisé, 30% détection avec indice intelligent) | 👧 Petite Fille |
| `/skip` | Passer son action de nuit | Voyante / Sorcière / Cupidon |
| `/vote @joueur` | Voter pour éliminer quelqu'un | Tous (vivants) |
| `/captainvote @joueur` | Voter pour le capitaine (auto-résolution) | Tous (vivants) |
| `/nextphase` | Avancer à la phase suivante | Tous |
| `/vote-end` | Voter pour arrêter la partie | Tous (vivants) |
| `/end` | Terminer la partie | Admin / Host |

### Progression

| Commande | Description |
|----------|-------------|
| `/stats [@joueur]` | Stats du joueur avec ELO, rang, succès |
| `/leaderboard [top]` | Classement ELO du serveur |
| `/history [limit]` | Historique des dernières parties |

### Administration

| Commande | Description |
|----------|-------------|
| `/setup wizard` | Assistant de configuration |
| `/setup category` | Définir la catégorie Discord |
| `/setup rules min max` | Règles par défaut (joueurs) |
| `/setup webhook url` | Webhook de monitoring |
| `/setup status` | Voir la configuration |
| `/setrules` | Modifier min/max joueurs et condition de victoire |
| `/clear` | Nettoyer les channels de jeu |
| `/force-end` | Terminer une partie (bypass) |
| `/lang fr\|en` | Changer la langue du bot |
| `/monitoring dashboard` | Métriques temps réel |
| `/monitoring health` | Santé du bot |
| `/ratelimit stats` | Stats anti-spam |

### Debug (Admin uniquement)

| Commande | Description |
|----------|-------------|
| `/debug-fake-join` | Ajouter des joueurs fictifs |
| `/debug-start-force` | Forcer le démarrage |
| `/debug-set-role` | Changer le rôle d'un joueur |
| `/debug-info` | État de la partie |
| `/debug-games` | Toutes les parties actives |
| `/debug-reset` | Supprimer la partie |
| `/debug-voicemute` | Désactiver le mute vocal |

---

## 🎯 Comment jouer

1. **Créer** — Un joueur tape `/create` dans la catégorie configurée
2. **Rejoindre** — Les joueurs cliquent sur le bouton **Rejoindre** du lobby ([voir le lobby](https://ibb.co/SCybtk7))
3. **Démarrer** — L'hôte clique sur **Démarrer** quand il y a assez de joueurs
4. **Attribution des rôles** — Chaque joueur reçoit son rôle en DM ([voir le DM](https://ibb.co/CKFXhDf2))
5. **Nuit** — Chaque rôle agit dans son salon privé, 120s max par rôle ([voir les channels](https://ibb.co/5Xd2zRqJ) · [phase de nuit](https://ibb.co/BHG2cLzZ))
6. **Jour** — Le village discute et vote pour éliminer un suspect
7. **Victoire** — Quand un camp a gagné, le récapitulatif s'affiche avec option de relancer

---

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js                # Point d'entrée, handlers Discord
├── commands/               # Commandes slash (auto-chargées)
├── game/
│   ├── gameManager.js      # Logique de jeu, phases, victoire (EventEmitter)
│   ├── achievements.js     # Moteur de succès + système ELO
│   ├── voiceManager.js     # Audio & connexions vocales
│   ├── phases.js           # Constantes de phases
│   └── roles.js            # Constantes de rôles
├── web/                    # 🌐 Tableau de bord web (v3.0+)
│   ├── server.js           # Serveur Express + Socket.IO
│   ├── routes/
│   │   ├── auth.js         # Routes Discord OAuth2
│   │   ├── api.js          # API REST (15 endpoints)
│   │   └── dashboard.js    # Routes pages HTML
│   ├── views/              # Templates EJS
│   │   ├── partials/       # Header & footer
│   │   ├── dashboard.ejs   # Tableau de bord
│   │   ├── spectator.ejs   # Spectateur live
│   │   ├── guild.ejs       # Page serveur
│   │   ├── player.ejs      # Profil joueur
│   │   └── roles.ejs       # Éditeur de rôles custom
│   └── public/             # Assets statiques (CSS, JS)
├── locales/
│   ├── fr.js               # Locale française (~500+ clés)
│   └── en.js               # Locale anglaise (~500+ clés)
├── utils/
│   ├── config.js           # Configuration centralisée (SQLite)
│   ├── i18n.js             # Système i18n (t(), translateRole/Phase)
│   ├── interaction.js      # safeReply, safeDefer
│   ├── lobbyBuilder.js     # Construction du lobby embed
│   ├── rateLimiter.js      # Token bucket anti-spam
│   └── validators.js       # Validations communes
├── database/
│   ├── db.js               # API SQLite (parties, joueurs, stats)
│   └── schema.sql          # Schéma des tables
├── monitoring/
│   ├── metrics.js          # Collecteur système/Discord/jeu
│   └── alerts.js           # Alertes webhook
├── Dockerfile              # Build Docker multi-stage
├── docker-compose.yml      # Compose production-ready
├── tests/                  # 268 tests Jest
├── audio/                  # Sons d'ambiance (.mp3)
└── img/                    # Images des rôles
```

---

## 🧪 Tests

```bash
npm test                    # Lancer tous les tests
npm run health              # Vérifier la santé du bot
npm run clear-commands      # Réinitialiser les commandes Discord
```

---

## 📊 Historique des versions

| Version | Highlights |
|---------|-----------|
| **v3.4.0** | 🎨 Refonte complète de l'interface web (navigation PJAX, dashboard centre de commandes, vue serveur, classement podium, wiki docs, page d'invitation landing), `/setup wizard` interactif, garde `/create`, fix nettoyage channels multi-guild, réconciliation de guildes, 268 tests |
| **v3.3.0** | 🚀 Renforcement production : matrice de crash/restart, tests d'isolation WebSocket anti-abus, observabilité GameMutex, verrou anti split-brain au démarrage, détection de liveness STUCK (`stuck_games_count`) |
| **v3.2.0** | 🛡️ Renforcement 6 axes : GameMutex, transitions FSM, sync transactionnelle, dirty flag, 7 nouvelles colonnes DB, isRecentDuplicate sur 12 commandes, express-rate-limit, CORS, WS guild-scoped, Prometheus /metrics, /health, 223 tests |
| **v3.1.0** | 🛡️ Audit architecture 15 points, élimination XSS, rate limiting & debounce WebSocket, isolation multi-tenant, fixes critiques FSM, archivage parties, 200 tests || **v3.0.0** | 🌐 Tableau de bord web (Express + EJS), Spectateur live (Socket.IO), API REST (15 endpoints), Discord OAuth2, Rôles personnalisés, Architecture EventEmitter || **v2.9.0** | 🏆 Succès (18), classement ELO (7 paliers), révélation rôle à la mort, notification DM de tour, `/leaderboard`, `/history`, timeline post-game, 4 bug fixes |
| **v3.4.1** | 🎨 Refonte visuelle : système de lueur ambiante global, redesign page joueur, UX spectateur, deck de cartes invitation, panneaux dashboard |
| **v2.8.0** | 🐳 Docker, backup SQLite auto (horaire), multi-guild (langue & config par serveur), système de revanche |
| **v2.7.0** | Petite Fille relay temps réel en DM, indices ambigus intelligents, normalisation Unicode/zalgo, wolfwin serveur-wide, commandes guild-only |
| **v2.6.0** | Équilibrage phases, vote capitaine auto, fix potion sorcière, victoire loups configurable, ping loups |
| **v2.5.1** | Nouveaux rôles (Salvateur, Ancien, Idiot), mode spectateur, thèmes d'embed, correctifs |
| **v2.4.0** | Système i18n centralisé FR/EN, commande `/lang`, 500+ clés traduites |
| **v2.3.0** | Audit complet (47 fixes), mode spectateur, `/skip`, stats joueurs en DB |
| **v2.2.1** | Hardening production (26 fixes), 191 tests, safeReply partout |
| **v2.2.0** | Commandes debug sécurisées, `/shoot`, `/vote-end`, AFK timeout 90s |
| **v2.1.0** | SQLite, rate limiting, monitoring, configuration centralisée |
| **v2.0.0** | Debouncing, cache API, optimisations (-650 lignes) |

Détails complets : [CHANGELOG.md](CHANGELOG.md)

---

## 📚 Documentation

| Document | Contenu |
|----------|---------|
| [CHANGELOG.md](CHANGELOG.md) | Historique détaillé des versions |
| [CONFIG.md](CONFIG.md) | Système de configuration |
| [DATABASE.md](DATABASE.md) | Architecture SQLite, schéma, API |
| [MONITORING.md](MONITORING.md) | Monitoring et alertes |
| [RATE_LIMITING.md](RATE_LIMITING.md) | Protection anti-spam |
| [LOGGING.md](LOGGING.md) | Système de logging |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Guide de dépannage |
| [TESTING.md](TESTING.md) | Guide des tests |

---

## 🤝 Contribution

1. Fork le projet
2. Créer une branche (`git checkout -b feature/ma-feature`)
3. Commit (`git commit -m 'feat: description'`)
4. Push (`git push origin feature/ma-feature`)
5. Ouvrir une Pull Request

---

**Version** : 3.4.1 · **Node.js** : ≥ 16.9.0 · **Discord.js** : ^14.25.1 · **Docker** : ready · **License** : ISC
