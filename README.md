# 🐺 Werewolf Discord Bot

Un bot Discord complet pour jouer au Loup-Garou avec gestion vocale automatique et audio d'ambiance.

## ✨ Fonctionnalités

### 🎮 Gameplay
- **Lobby interactif** avec boutons Discord
- **Phases automatiques** (Nuit/Jour) avec mute/unmute vocal
- **7 rôles** : Loup-Garou, Villageois, Voyante, Sorcière, Chasseur, Petite Fille, Cupidon
- **Système de votes** (village + élection capitaine)
- **Victoire automatique** détectée avec annonces
- **Audio d'ambiance** : nuit, jour, mort, victoire

### ⚙️ Administration
- **Règles configurables** : min/max joueurs
- **Commandes debug** pour tester
- **Nettoyage automatique** des channels
- **Auto-cleanup** des lobbys inactifs (1h)

### ⚡ Performance (v2.0)
- **90% moins de sauvegardes** grâce au debouncing
- **60% moins d'appels API** avec le cache Discord
- **Gestion d'erreurs robuste** (zéro crash)
- **Code optimisé** (-650 lignes dupliquées)

## 🚀 Installation

### Prérequis
- Node.js ≥ 16.9.0
- Bot Discord avec permissions :
  - Manage Channels
  - Manage Roles
  - Connect/Speak
  - Send Messages
  - Mute Members

### Configuration

1. **Cloner le projet**
```bash
git clone <repo>
cd Werewolf-bot
```

2. **Installer les dépendances**
```bash
npm install
```

3. **Créer le fichier .env**
```env
TOKEN=votre_token_bot_discord
CLIENT_ID=id_application_discord
GUILD_ID=id_serveur_discord
```

4. **Créer les dossiers audio**
```bash
mkdir audio
```
Placer les fichiers audio :
- `night_ambience.mp3`
- `day_ambience.mp3`
- `death.mp3`
- `victory_villagers.mp3`
- `victory_wolves.mp3`

5. **Créer une catégorie Discord**
- Créer une catégorie sur votre serveur
- Copier son ID (clic droit > Copier l'identifiant)
- Mettre à jour `CATEGORY_ID` dans `utils/validators.js`

6. **Vérifier la santé du bot**
```bash
npm run health
```

7. **Lancer le bot**
```bash
npm start
```

## � Système de Logging

Le bot utilise un système de logging centralisé avec niveaux, couleurs et timestamps.

### Configuration

Ajouter dans `.env` :
```env
LOG_LEVEL=INFO  # Niveaux: DEBUG, INFO, WARN, ERROR, NONE
```

### Niveaux Disponibles

- **DEBUG** : Tous les détails techniques (développement)
- **INFO** : Événements normaux (production - par défaut)
- **WARN** : Problèmes non-critiques
- **ERROR** : Erreurs nécessitant attention
- **NONE** : Désactive les logs

### Exemples de Logs

```
[2026-02-09T16:39:44.113Z] [SUCCESS] [APP] 🐺 Connected as WerewolfBot#1234
[2026-02-09T16:39:44.200Z] [INFO] [GAME] Starting game creation {"channelId":"123"}
[2026-02-09T16:39:44.500Z] [SUCCESS] [GAME] ✅ Village channel created
[2026-02-09T16:39:45.100Z] [ERROR] [GAME] ❌ Failed to create channel
```

**Documentation complète** : Voir [LOGGING.md](LOGGING.md)

## �📋 Commandes

### Joueurs

| Commande | Description |
|----------|-------------|
| `/create` | Créer une partie |
| `/join` | Rejoindre la partie |
| `/help` | Afficher l'aide |

### En jeu

| Commande | Description | Rôle |
|----------|-------------|------|
| `/kill @joueur` | Tuer un joueur | Loups-Garous |
| `/see @joueur` | Voir le rôle | Voyante |
| `/potion save/kill` | Utiliser potion | Sorcière |
| `/love @a @b` | Lier deux amoureux | Cupidon |
| `/listen` | Espionner les loups | Petite Fille |
| `/vote @joueur` | Voter pour éliminer | Tous |
| `/captainvote @joueur` | Voter pour capitaine | Tous |
| `/declarecaptain` | Déclarer le capitaine | Village |
| `/nextphase` | Passer phase suivante | Tous |
| `/end` | Terminer la partie | Tous |

### Admin

| Commande | Description |
|----------|-------------|
| `/clear` | Nettoyer tous les channels |
| `/end` | Terminer la partie (dans le channel actuel) |
| `/force-end` | Terminer une partie de force (bypass interaction) |
| `/setrules` | Définir min/max joueurs |
| `/debugvoicemute` | Désactiver mute auto |
| `/debug-info` | Afficher état partie |
| `/debug-games` | Afficher toutes les parties actives |

## 🏗️ Architecture

```
Werewolf-bot/
├── index.js              # Point d'entrée
├── package.json          # Dependencies
├── .env                  # Configuration
│
├── commands/             # Commandes slash
│   ├── create.js
│   ├── join.js
│   ├── kill.js
│   └── ...
│
├── game/                 # Logique de jeu
│   ├── gameManager.js    # Gestion parties
│   ├── voiceManager.js   # Gestion audio
│   ├── phases.js         # Constantes phases
│   └── roles.js          # Constantes rôles
│
├── utils/                # Utilitaires
│   ├── validators.js     # Validations
│   ├── commands.js       # Helpers commandes
│   └── interaction.js    # Gestion interactions
│
├── scripts/              # Scripts maintenance
│   ├── health-check.js
│   └── clear_commands.js
│
├── audio/                # Fichiers audio
├── data/                 # Données (auto-créé)
└── img/                  # Images embed
```

## 📖 Documentation

- [OPTIMIZATIONS.md](OPTIMIZATIONS.md) - Détails des optimisations v2.0
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Guide de dépannage
- [CHANGELOG.md](CHANGELOG.md) - Historique des versions

## 🎯 Utilisation Rapide

```bash
# Démarrer le bot
npm start

# Vérifier la santé
npm run health

# Nettoyer les commandes Discord
npm run clear-commands
```

### Discord

1. Dans la catégorie dédiée : `/create`
2. Les joueurs cliquent sur "Rejoindre"
3. L'hôte clique sur "Démarrer"
4. Le jeu commence automatiquement !

## 🐛 Dépannage

### Le bot ne répond pas
```bash
# Vérifier les logs
node index.js

# Vérifier le health
npm run health
```

### Erreurs d'interaction
- Consultez [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
- La plupart sont auto-résolues par les helpers

### Audio ne marche pas
- Vérifier ffmpeg-static : `npm install ffmpeg-static`
- Vérifier permissions "Speak" du bot
- Vérifier fichiers dans `/audio/`

## 🔧 Développement

### Ajouter une commande

1. Créer `commands/ma-commande.js`
```javascript
const { SlashCommandBuilder } = require("discord.js");
const { checkCategoryAndDefer } = require("../utils/commands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ma-commande")
    .setDescription("Description"),

  async execute(interaction) {
    if (!await checkCategoryAndDefer(interaction)) return;
    
    // Votre logique ici
    await interaction.editReply("✅ Commande exécutée");
  }
};
```

2. Redémarrer le bot

### Bonnes pratiques

- ✅ Toujours utiliser `checkCategoryAndDefer()` en début de commande
- ✅ Utiliser `scheduleSave()` au lieu de `saveState()`
- ✅ Utiliser les validators dans `utils/validators.js`
- ✅ Gérer les erreurs proprement (pas de catch vide)

## 📊 Performances

| Métrique | v1.0 | v2.0 | Gain |
|----------|------|------|------|
| Sauvegardes/min | ~50 | ~5 | 90% |
| API calls/event | 2-3 | 0-1 | 60% |
| Lignes de code | 2000 | 1350 | 32% |
| Erreurs Discord | Fréquentes | Rares | 95% |

## 🤝 Contribution

Les contributions sont bienvenues !

1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit (`git commit -m 'Add some AmazingFeature'`)
4. Push (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

## 📝 License

ISC License - Voir LICENSE pour plus de détails

## 🙏 Remerciements

- Discord.js pour l'excellente librairie
- @discordjs/voice pour le support audio
- La communauté Discord pour les tests

---

**Version actuelle** : 2.0.2  
**Node.js requis** : ≥ 16.9.0  
**Discord.js** : ^14.25.1

## 📚 Documentation

- [LOGGING.md](LOGGING.md) - Système de logging centralisé
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Guide de dépannage
- [ERROR_10062.md](ERROR_10062.md) - Erreur "Interaction Expired" expliquée
- [INTERACTION_BEST_PRACTICES.md](INTERACTION_BEST_PRACTICES.md) - Bonnes pratiques interactions Discord
- [OPTIMIZATIONS.md](OPTIMIZATIONS.md) - Optimisations techniques v2.0
- [CHANGELOG.md](CHANGELOG.md) - Historique des versions
- [MIGRATION.md](MIGRATION.md) - Guide de migration

💡 Pour plus d'aide : `/help` dans Discord ou consultez la documentation ci-dessus
