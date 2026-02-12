# 🐺 Werewolf Discord Bot

Un bot Discord complet pour jouer au **Loup-Garou de Thiercelieux** avec gestion vocale automatique, audio d'ambiance et lobby interactif.

![Version](https://img.shields.io/badge/version-2.3.0-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A5%2016.9.0-green)
![Discord.js](https://img.shields.io/badge/discord.js-v14-blueviolet)
![Tests](https://img.shields.io/badge/tests-191%20passed-brightgreen)

---

## ✨ Fonctionnalités

### 🎮 Gameplay
- **Lobby interactif** — Boutons Rejoindre / Quitter / Démarrer avec aperçu des rôles en temps réel
- **7 rôles** — Loup-Garou, Villageois, Voyante, Sorcière, Chasseur, Petite Fille, Cupidon
- **Phases automatiques** — Alternance Nuit / Jour avec mute/unmute vocal automatique
- **Système de votes** — Vote du village, élection du capitaine (vote ×2), égalité départagée
- **Détection de victoire** — Village, Loups, Amoureux, Égalité
- **Audio d'ambiance** — Sons de nuit, jour, mort et victoire dans le vocal
- **Mode spectateur** — Les joueurs morts voient tous les salons en lecture seule

### ⚙️ Administration
- **Configuration par commandes** — `/setup wizard` pour tout configurer
- **Règles personnalisables** — Min/max joueurs ajustables
- **Commandes debug** — Joueurs fictifs, forcer un démarrage, inspecter l'état
- **Nettoyage automatique** — Channels de jeu et lobbys inactifs (1h)
- **Rate limiting** — Protection anti-spam avec ban automatique
- **Monitoring** — Dashboard temps réel, alertes webhook, historique 24h

### 🗄️ Technique
- **Persistance SQLite** — État des parties, stats joueurs, actions de nuit, métriques
- **Gestion d'erreurs robuste** — safeReply, graceful shutdown, zero crash en production
- **191 tests automatisés** — 15 suites, 0 failures

---

## 🚀 Installation

### Prérequis
- **Node.js** ≥ 16.9.0
- Un **bot Discord** avec les permissions : Manage Channels, Manage Roles, Connect, Speak, Send Messages, Mute Members

### Mise en place

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
| `/listen` | Espionner les loups | 👧 Petite Fille |
| `/skip` | Passer son action de nuit | Voyante / Sorcière / Cupidon |
| `/vote @joueur` | Voter pour éliminer quelqu'un | Tous (vivants) |
| `/captainvote @joueur` | Voter pour le capitaine | Tous (vivants) |
| `/declarecaptain` | Déclarer le capitaine élu | Village |
| `/nextphase` | Avancer à la phase suivante | Tous |
| `/vote-end` | Voter pour arrêter la partie | Tous (vivants) |
| `/end` | Terminer la partie | Admin / Host |

### Administration

| Commande | Description |
|----------|-------------|
| `/setup wizard` | Assistant de configuration |
| `/setup category` | Définir la catégorie Discord |
| `/setup rules min max` | Règles par défaut (joueurs) |
| `/setup webhook url` | Webhook de monitoring |
| `/setup status` | Voir la configuration |
| `/setrules` | Modifier min/max joueurs d'une partie |
| `/clear` | Nettoyer les channels de jeu |
| `/force-end` | Terminer une partie (bypass) |
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
2. **Rejoindre** — Les joueurs cliquent sur le bouton **Rejoindre** du lobby
3. **Démarrer** — L'hôte clique sur **Démarrer** quand il y a assez de joueurs
4. **Nuit** — Chaque rôle agit dans son salon privé (90s max par rôle)
5. **Jour** — Le village discute et vote pour éliminer un suspect
6. **Victoire** — Quand un camp a gagné, le récapitulatif s'affiche avec option de relancer

---

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js                # Point d'entrée, handlers Discord
├── commands/               # Commandes slash (auto-chargées)
├── game/
│   ├── gameManager.js      # Logique de jeu, phases, victoire
│   ├── voiceManager.js     # Audio & connexions vocales
│   ├── phases.js           # Constantes de phases
│   └── roles.js            # Constantes de rôles
├── utils/
│   ├── config.js           # Configuration centralisée (SQLite)
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
├── tests/                  # 191 tests Jest
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

**Version** : 2.3.0 · **Node.js** : ≥ 16.9.0 · **Discord.js** : ^14.25.1 · **License** : ISC
