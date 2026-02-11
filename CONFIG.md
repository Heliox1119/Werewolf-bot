# ⚙️ Configuration Centralisée - Werewolf Bot

Documentation complète du système de configuration centralisée du bot Werewolf.

## 📋 Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Commande /setup](#commande-setup)
- [Module ConfigManager](#module-configmanager)
- [Clés de configuration](#clés-de-configuration)
- [Assistant de configuration](#assistant-de-configuration)
- [Utilisation dans le code](#utilisation-dans-le-code)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Vue d'ensemble

Le système de configuration centralisée permet de **stocker et gérer tous les paramètres du bot** de manière unifiée :

- ✅ **Stockage SQLite** : Configurations persistantes dans la table `config`
- ✅ **Commande /setup** : Configuration interactive via Discord
- ✅ **Cache en mémoire** : Accès rapide aux valeurs
- ✅ **API simple** : `config.get()`, `config.set()`, méthodes typées
- ✅ **Validation** : Vérification du setup complet au démarrage
- ✅ **Migration automatique** : Plus de valeurs hardcodées dans le code

### Pourquoi centraliser ?

**Avant (hardcodé) :**
```javascript
const CATEGORY_ID = "1469976287790633146"; // Dans 5 fichiers différents
```

**Après (centralisé) :**
```javascript
const config = ConfigManager.getInstance();
const categoryId = config.getCategoryId(); // Depuis la DB
```

---

## 🔧 Commande /setup

### Sous-commandes

#### `/setup category <category>`

Configure la catégorie Discord où les channels de jeu seront créés.

**Paramètres :**
- `category` (Catégorie Discord, requis) : La catégorie à utiliser

**Exemple :**
```
/setup category category:#werewolf-games
```

**Résultat :**
```
✅ Catégorie configurée
La catégorie Werewolf Games a été définie pour les channels de jeu.

📋 ID: 1469976287790633146
📍 Position: Position 3
```

---

#### `/setup webhook [url]`

Configure le webhook Discord pour recevoir les alertes de monitoring.

**Paramètres :**
- `url` (String, optionnel) : URL du webhook (laisser vide pour désactiver)

**Exemple :**
```
/setup webhook url:https://discord.com/api/webhooks/xxxxx/yyyyyy
```

**Résultat :**
```
✅ Webhook configuré
Le webhook de monitoring a été configuré avec succès.

🔗 URL: https://discord.com/api/webhooks/xxxxx...
📡 Statut: Les alertes seront envoyées sur ce webhook
```

**Désactiver :**
```
/setup webhook
```

---

#### `/setup rules [min_players] [max_players]`

Configure les règles par défaut des parties.

**Paramètres :**
- `min_players` (Nombre, 3-20, optionnel) : Minimum de joueurs
- `max_players` (Nombre, 3-20, optionnel) : Maximum de joueurs

**Exemple :**
```
/setup rules min_players:5 max_players:12
```

**Résultat :**
```
✅ Règles configurées
Les règles par défaut des parties ont été mises à jour.

👥 Minimum: 5
👥 Maximum: 12
```

---

#### `/setup monitoring [interval] [alerts_enabled]`

Configure le système de monitoring.

**Paramètres :**
- `interval` (Nombre, 30-300s, optionnel) : Intervalle de collecte en secondes
- `alerts_enabled` (Boolean, optionnel) : Activer/désactiver les alertes

**Exemple :**
```
/setup monitoring interval:120 alerts_enabled:true
```

**Résultat :**
```
✅ Monitoring configuré
Les paramètres de monitoring ont été mis à jour.

🔧 Changements
• Intervalle: 120s
• Alertes: Activées
```

---

#### `/setup status`

Affiche la configuration actuelle du bot.

**Résultat :**

<details>
<summary>Configuration complète (cliquer pour voir)</summary>

```
⚙️ Configuration du bot
✅ Setup complet - Le bot est configuré et prêt

📡 Discord
Catégorie: #werewolf-games (1469976287790633146)
Emojis: 7 configurés

📊 Monitoring
Webhook: ✓ Configuré
Alertes: ✅ Activées
Intervalle: 60s

🎮 Parties
Joueurs: 5-10
Rôles activés: 7
Timeout lobby: 60min

📈 Statistiques
Clés totales: 12
```

</details>

**Si setup incomplet :**

```
⚙️ Configuration du bot
⚠️ Setup incomplet - Configuration requise

...

⚠️ Configuration requise
• ID de la catégorie Discord (`discord.category_id`)

Utilisez /setup wizard pour une configuration guidée
```

---

#### `/setup wizard`

Lance l'assistant de configuration interactive (première installation).

**Résultat :**

```
🧙 Assistant de configuration
Bienvenue dans l'assistant de configuration du bot Werewolf !

Pour configurer le bot, suivez ces étapes :

1️⃣ Catégorie Discord (Requis)
Action : Créer une catégorie sur votre serveur
Commande : /setup category
Info : Les channels de jeu seront créés dans cette catégorie

2️⃣ Webhook monitoring (Optionnel)
Action : Créer un webhook dans un salon (ex: #bot-logs)
Commande : /setup webhook url:<webhook_url>
Info : Recevez des alertes automatiques sur les problèmes du bot

3️⃣ Règles par défaut (Optionnel)
Commande : /setup rules min_players:5 max_players:10
Info : Définir les règles par défaut des parties
Actuel : 5-10 joueurs

✅ Vérification
Utilisez /setup status pour vérifier votre configuration
```

---

## 🏗️ Module ConfigManager

### Initialisation

Le ConfigManager est automatiquement initialisé au démarrage du bot :

```javascript
// index.js (déjà fait)
const ConfigManager = require('./utils/config');
const GameDatabase = require('./database/db');

const db = new GameDatabase();
ConfigManager.initialize(db.db);
```

### Singleton Pattern

```javascript
const ConfigManager = require('./utils/config');
const config = ConfigManager.getInstance();
```

### API de base

#### `get(key, defaultValue)`
Récupère une valeur de configuration.

```javascript
const categoryId = config.get('discord.category_id', null);
// => "1469976287790633146" ou null
```

#### `set(key, value)`
Définit une valeur de configuration.

```javascript
config.set('discord.category_id', '1469976287790633146');
// => true (succès)
```

#### `has(key)`
Vérifie si une clé existe.

```javascript
if (config.has('discord.category_id')) {
  // Catégorie configurée
}
```

#### `delete(key)`
Supprime une configuration.

```javascript
config.delete('monitoring.webhook_url');
// => true (succès)
```

#### `getAll()`
Récupère toutes les configurations.

```javascript
const allConfig = config.getAll();
// => { 'discord.category_id': '...', ... }
```

#### `reload()`
Recharge le cache depuis la DB.

```javascript
config.reload();
```

---

## 🔑 Clés de configuration

### Clés prédéfinies avec méthodes typées

#### Discord

**`discord.category_id`** : ID de la catégorie Discord

```javascript
// Getter
const categoryId = config.getCategoryId();
// => "1469976287790633146" ou null

// Setter
config.setCategoryId('1469976287790633146');
```

**`discord.emojis`** : Emojis personnalisés

```javascript
const emojis = config.getEmojis();
// => { wolf: '🐺', villager: '👨', ... }

config.setEmojis({
  wolf: '🐺',
  villager: '👨',
  seer: '🔮',
  witch: '🧙',
  hunter: '🎯',
  cupid: '💘',
  littleGirl: '👧'
});
```

---

#### Monitoring

**`monitoring.webhook_url`** : URL du webhook Discord

```javascript
const webhookUrl = config.getMonitoringWebhookUrl();
// => "https://discord.com/api/webhooks/..." ou null

config.setMonitoringWebhookUrl('https://...');
```

**`monitoring.alerts_enabled`** : Alertes activées

```javascript
const enabled = config.isMonitoringAlertsEnabled();
// => true ou false

config.setMonitoringAlertsEnabled(true);
```

**`monitoring.metrics_interval`** : Intervalle de collecte (ms)

```javascript
const interval = config.getMetricsInterval();
// => 60000 (60s par défaut)

config.setMetricsInterval(120000); // 120s
```

---

#### Jeux

**`game.default_rules`** : Règles par défaut

```javascript
const rules = config.getDefaultGameRules();
// => { minPlayers: 5, maxPlayers: 10, disableVoiceMute: false }

config.setDefaultGameRules({
  minPlayers: 6,
  maxPlayers: 12,
  disableVoiceMute: false
});
```

**`game.enabled_roles`** : Rôles activés

```javascript
const roles = config.getEnabledRoles();
// => ['Loup-Garou', 'Voyante', ...]

config.setEnabledRoles(['Loup-Garou', 'Villageois']);
```

**`game.lobby_timeout`** : Timeout des lobbys (ms)

```javascript
const timeout = config.getLobbyTimeout();
// => 3600000 (1h par défaut)

config.setLobbyTimeout(7200000); // 2h
```

---

### Validation du setup

#### `isSetupComplete()`

Vérifie si le setup initial est complet.

```javascript
if (!config.isSetupComplete()) {
  console.log('Setup required!');
}
```

#### `getMissingSetupKeys()`

Récupère les clés manquantes.

```javascript
const missing = config.getMissingSetupKeys();
// => [{ key: 'discord.category_id', description: 'ID de la catégorie Discord' }]
```

#### `getSummary()`

Récupère un résumé de la configuration.

```javascript
const summary = config.getSummary();
console.log(summary);
```

**Résultat :**

```javascript
{
  setupComplete: true,
  discord: {
    categoryId: '1469976287790633146',
    emojis: 7
  },
  monitoring: {
    webhookUrl: '✓ Configuré',
    alertsEnabled: true,
    metricsInterval: '60s'
  },
  game: {
    defaultRules: { minPlayers: 5, maxPlayers: 10, disableVoiceMute: false },
    enabledRoles: 7,
    lobbyTimeout: '60min'
  },
  totalKeys: 12
}
```

---

## 🚀 Utilisation dans le code

### Exemple 1 : Valider la catégorie

**utils/validators.js** (Migré) :

```javascript
const ConfigManager = require('./config');

async function isInGameCategory(interaction) {
  const config = ConfigManager.getInstance();
  const CATEGORY_ID = config.getCategoryId();
  
  if (!CATEGORY_ID) {
    // Configuration non faite
    return false;
  }
  
  const channel = interaction.guild.channels.cache.get(interaction.channelId);
  return channel.parentId === CATEGORY_ID;
}
```

### Exemple 2 : Créer une partie

**commands/create.js** (Migré) :

```javascript
const ConfigManager = require('../utils/config');

async execute(interaction) {
  const config = ConfigManager.getInstance();
  const CATEGORY_ID = config.getCategoryId();
  
  if (!CATEGORY_ID) {
    await interaction.reply({
      content: '❌ Le bot n\'est pas configuré. Un administrateur doit utiliser `/setup category`.',
      ephemeral: true
    });
    return;
  }
  
  // Créer les channels dans la catégorie
  await createChannels(guild, CATEGORY_ID);
}
```

### Exemple 3 : Monitoring

**index.js** (Migré) :

```javascript
const config = ConfigManager.getInstance();

// Utiliser le webhook de la config
const webhookUrl = config.getMonitoringWebhookUrl();

// Utiliser l'intervalle configuré
const metricsInterval = config.getMetricsInterval();
metrics.startCollection(metricsInterval);

// Activer/désactiver les alertes
alerts.setEnabled(config.isMonitoringAlertsEnabled());
```

### Exemple 4 : Règles de jeu

```javascript
const config = ConfigManager.getInstance();
const defaultRules = config.getDefaultGameRules();

const game = gameManager.create(channelId, {
  minPlayers: defaultRules.minPlayers,
  maxPlayers: defaultRules.maxPlayers
});
```

---

## 📦 Structure de la table `config`

```sql
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

**Exemple de données :**

| key | value | updated_at |
|-----|-------|-----------|
| `discord.category_id` | `"1469976287790633146"` | 1704067200 |
| `monitoring.webhook_url` | `"https://discord.com/..."` | 1704067201 |
| `monitoring.alerts_enabled` | `true` | 1704067202 |
| `monitoring.metrics_interval` | `60000` | 1704067203 |
| `game.default_rules` | `{"minPlayers":5,"maxPlayers":10}` | 1704067204 |

**Notes :**
- Les valeurs complexes (objets) sont stockées en JSON
- Les valeurs simples (string, number, boolean) sont converties en string
- `updated_at` est mis à jour automatiquement

---

## 🔍 Vérification au démarrage

Le bot vérifie automatiquement si le setup est complet au démarrage :

```
[2025-01-10 10:30:00] [SUCCESS] Configuration system initialized
[2025-01-10 10:30:00] [WARN] Bot setup incomplete! Use /setup wizard to configure
[2025-01-10 10:30:00] [WARN] Missing configuration: ["discord.category_id"]
```

Si setup complet :

```
[2025-01-10 10:30:00] [SUCCESS] Configuration system initialized
[2025-01-10 10:30:00] [SUCCESS] Bot configuration complete
```

---

## 🔧 Troubleshooting

### Problème : "Bot non configuré"

**Symptôme :**
```
❌ Le bot n'est pas configuré. Un administrateur doit utiliser /setup category
```

**Solution :**
1. Utilisez `/setup wizard` pour voir les étapes
2. Créez une catégorie sur votre serveur
3. Utilisez `/setup category` pour la configurer
4. Vérifiez avec `/setup status`

---

### Problème : Configuration perdue après redémarrage

**Cause :** Base de données supprimée ou corrompue

**Solution :**
```bash
# Vérifier que data/werewolf.db existe
ls data/werewolf.db

# Reconfigurer si nécessaire
/setup category
```

---

### Problème : "ConfigManager not initialized"

**Cause :** ConfigManager appelé avant l'initialisation

**Solution :**

Assurez-vous d'appeler après `clientReady` :

```javascript
client.once("clientReady", async () => {
  // Initialiser d'abord
  ConfigManager.initialize(db.db);
  
  // Puis utiliser
  const config = ConfigManager.getInstance();
});
```

---

### Problème : Valeurs non mises à jour

**Cause :** Cache non rechargé

**Solution :**

```javascript
const config = ConfigManager.getInstance();
config.reload(); // Recharger depuis la DB
```

---

## 📊 Requêtes SQL utiles

### Voir toutes les configurations

```sql
SELECT * FROM config;
```

### Voir une configuration spécifique

```sql
SELECT value FROM config WHERE key = 'discord.category_id';
```

### Mettre à jour manuellement

```sql
UPDATE config 
SET value = '1469976287790633146', updated_at = strftime('%s', 'now')
WHERE key = 'discord.category_id';
```

### Supprimer une configuration

```sql
DELETE FROM config WHERE key = 'monitoring.webhook_url';
```

### Réinitialiser tout

```sql
DELETE FROM config WHERE key NOT IN ('schema_version');
```

---

## 🎯 Bonnes pratiques

### ✅ À faire

1. **Utiliser les méthodes typées** quand disponibles
   ```javascript
   config.getCategoryId() // ✅ Bon
   config.get('discord.category_id') // ⚠️ Moins bien
   ```

2. **Vérifier les valeurs nulles**
   ```javascript
   const categoryId = config.getCategoryId();
   if (!categoryId) {
     // Gérer le cas non configuré
   }
   ```

3. **Utiliser des valeurs par défaut**
   ```javascript
   const interval = config.get('custom.interval', 60000);
   ```

4. **Documenter les nouvelles clés**
   - Ajouter dans CONFIG.md
   - Créer une méthode typée si utilisée souvent

### ❌ À éviter

1. **Ne pas hardcoder les valeurs**
   ```javascript
   const CATEGORY_ID = "1469976287790633146"; // ❌ Non
   const categoryId = config.getCategoryId(); // ✅ Oui
   ```

2. **Ne pas modifier directement la DB**
   ```javascript
   // ❌ Non
   db.run("UPDATE config SET value = ? WHERE key = ?", value, key);
   
   // ✅ Oui
   config.set(key, value);
   ```

3. **Ne pas ignorer les erreurs de setup**
   ```javascript
   // ❌ Non
   const categoryId = config.getCategoryId() || "default";
   
   // ✅ Oui
   if (!config.isSetupComplete()) {
     throw new Error('Bot not configured');
   }
   ```

---

## 📚 Références

- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [Discord.js Guide](https://discordjs.guide/)

---

## 🔄 Migration depuis les valeurs hardcodées

### Fichiers migrés

- ✅ `utils/validators.js` : `CATEGORY_ID` → `config.getCategoryId()`
- ✅ `commands/create.js` : `CATEGORY_ID` → `config.getCategoryId()`
- ✅ `index.js` : `CATEGORY_ID` → `config.getCategoryId()`

### Script de migration (si nécessaire)

Si vous aviez des données dans l'ancien système JSON :

```javascript
// scripts/migrate-to-config.js
const ConfigManager = require('../utils/config');
const GameDatabase = require('../database/db');

const db = new GameDatabase();
ConfigManager.initialize(db.db);
const config = ConfigManager.getInstance();

// Migrer les anciennes valeurs
config.setCategoryId('1469976287790633146');
config.setDefaultGameRules({ minPlayers: 5, maxPlayers: 10 });

console.log('Migration complete!');
```

---

**Made with ❤️ for Werewolf Bot v2.2.0**
