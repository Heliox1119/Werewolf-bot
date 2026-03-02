# ⚙️ Configuration Centralisée - Résumé Exécutif

> **TL;DR** : Configuration unifiée du bot via commande `/setup` avec stockage SQLite. Plus de valeurs hardcodées, tout est configurable depuis Discord.

## 🎯 Que fait le système de configuration ?

**Configuration centralisée :**
- ⚙️ **Commande `/setup`** : Configuration interactive depuis Discord (admin uniquement)
- 💾 **Stockage SQLite** : Toutes les configurations dans la table `config`
- 🚀 **Cache mémoire** : Accès ultra-rapide aux paramètres
- ✅ **Validation** : Vérification du setup au démarrage
- 📊 **API simple** : `config.getCategoryId()`, `config.set()`, etc.

## ⚡ Quick Start

### 1. Première installation

```
/setup wizard
```

L'assistant vous guide pour configurer :
1. **Catégorie Discord** (requis) : Où créer les channels de jeu
2. **Webhook monitoring** (optionnel) : Alertes automatiques
3. **Règles par défaut** (optionnel) : min/max joueurs

### 2. Configuration rapide

```bash
# 1. Créer une catégorie sur votre serveur (ex: "Werewolf Games")

# 2. Configurer la catégorie (REQUIS)
/setup category category:#werewolf-games

# 3. Vérifier le setup
/setup status
```

### 3. Configuration optionnelle

```
# Webhook pour alertes monitoring
/setup webhook url:https://discord.com/api/webhooks/xxxxx/yyyyyy

# Règles par défaut
/setup rules min_players:5 max_players:12

# Monitoring
/setup monitoring interval:120 alerts_enabled:true
```

### 4. C'est tout !

Le bot est configuré et prêt à l'emploi.

---

## 🔧 Commandes `/setup`

| Commande | Description | Exemple |
|----------|-------------|---------|
| `/setup wizard` | Assistant de configuration | - |
| `/setup category <category>` | Configurer la catégorie Discord (REQUIS) | `/setup category category:#werewolf-games` |
| `/setup webhook [url]` | Configurer le webhook monitoring | `/setup webhook url:https://...` |
| `/setup rules [min] [max]` | Règles par défaut des parties | `/setup rules min_players:5 max_players:10` |
| `/setup monitoring [interval] [alerts]` | Paramètres de monitoring | `/setup monitoring interval:120 alerts_enabled:true` |
| `/setup status` | Afficher la configuration actuelle | - |

---

## 📊 Exemple de `/setup status`

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

## 🏗️ Architecture

```
Bot Discord
    │
    ├─ ConfigManager (singleton)
    │   ├─ Cache mémoire (Map)
    │   └─ SQLite (table config)
    │
    ├─ Commande /setup (interface admin)
    │   ├─ /setup wizard
    │   ├─ /setup category (REQUIS)
    │   ├─ /setup webhook
    │   ├─ /setup rules
    │   ├─ /setup monitoring
    │   └─ /setup status
    │
    └─ Vérification au démarrage
        ├─ isSetupComplete()
        ├─ getMissingSetupKeys()
        └─ Warnings dans les logs
```

---

## 🔑 Clés de configuration prédéfinies

### Discord

```javascript
// Catégorie Discord (REQUIS)
config.getCategoryId()
config.setCategoryId('1469976287790633146')

// Emojis personnalisés
config.getEmojis()
config.setEmojis({ wolf: '🐺', villager: '👨', ... })
```

### Monitoring

```javascript
// Webhook Discord
config.getMonitoringWebhookUrl()
config.setMonitoringWebhookUrl('https://discord.com/api/webhooks/...')

// Alertes activées
config.isMonitoringAlertsEnabled()
config.setMonitoringAlertsEnabled(true)

// Intervalle de collecte (ms)
config.getMetricsInterval()
config.setMetricsInterval(120000) // 120s
```

### Jeux

```javascript
// Règles par défaut
config.getDefaultGameRules()
// => { minPlayers: 5, maxPlayers: 10, disableVoiceMute: false }

config.setDefaultGameRules({ minPlayers: 6, maxPlayers: 12 })

// Rôles activés
config.getEnabledRoles()
// => ['Loup-Garou', 'Voyante', ...]

// Timeout des lobbys (ms)
config.getLobbyTimeout()
// => 3600000 (1h)
```

---

## 💻 Utilisation dans le code

### API de base

```javascript
const ConfigManager = require('./utils/config');
const config = ConfigManager.getInstance();

// Getter générique
const value = config.get('discord.category_id', null);

// Setter générique
config.set('discord.category_id', '1469976287790633146');

// Vérifier existence
if (config.has('discord.category_id')) {
  // Configuré
}

// Tout récupérer
const allConfig = config.getAll();

// Recharger depuis DB
config.reload();
```

### Méthodes typées (recommandées)

```javascript
// Discord
const categoryId = config.getCategoryId();
const emojis = config.getEmojis();

// Monitoring
const webhookUrl = config.getMonitoringWebhookUrl();
const alertsEnabled = config.isMonitoringAlertsEnabled();
const interval = config.getMetricsInterval();

// Jeux
const rules = config.getDefaultGameRules();
const roles = config.getEnabledRoles();
const timeout = config.getLobbyTimeout();
```

### Validation

```javascript
// Vérifier setup complet
if (!config.isSetupComplete()) {
  throw new Error('Bot not configured');
}

// Récupérer les clés manquantes
const missing = config.getMissingSetupKeys();
// => [{ key: 'discord.category_id', description: '...' }]

// Résumé de la configuration
const summary = config.getSummary();
console.log(summary);
```

---

## 🚀 Exemples d'utilisation

### Exemple 1 : Vérifier la catégorie avant création

```javascript
const config = ConfigManager.getInstance();
const categoryId = config.getCategoryId();

if (!categoryId) {
  await interaction.reply({
    content: '❌ Bot non configuré. Utilisez `/setup category`',
    ephemeral: true
  });
  return;
}

// Créer les channels dans la catégorie
await guild.channels.create('village', {
  type: ChannelType.GuildText,
  parent: categoryId
});
```

### Exemple 2 : Utiliser les règles par défaut

```javascript
const config = ConfigManager.getInstance();
const rules = config.getDefaultGameRules();

const game = gameManager.create(channelId, {
  minPlayers: rules.minPlayers,
  maxPlayers: rules.maxPlayers
});
```

### Exemple 3 : Monitoring avec configuration

```javascript
const config = ConfigManager.getInstance();

// Webhook depuis la config
const webhookUrl = config.getMonitoringWebhookUrl();
AlertSystem.initialize(webhookUrl);

// Intervalle depuis la config
const interval = config.getMetricsInterval();
metrics.startCollection(interval);

// Alertes selon config
alerts.setEnabled(config.isMonitoringAlertsEnabled());
```

---

## 📦 Table SQLite `config`

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
| `game.default_rules` | `{"minPlayers":5,"maxPlayers":10}` | 1704067203 |

---

## 🔍 Vérification au démarrage

```
[SUCCESS] Configuration system initialized
[WARN] Bot setup incomplete! Use /setup wizard to configure
[WARN] Missing configuration: ["discord.category_id"]
```

✅ **Setup complet :**

```
[SUCCESS] Configuration system initialized
[SUCCESS] Bot configuration complete
```

---

## 🎯 Cas d'usage

### 1. Bot non configuré

**Symptôme :**
```
❌ Le bot n'est pas configuré. Un administrateur doit utiliser /setup category
```

**Solution :**
```
/setup wizard
/setup category category:#werewolf-games
/setup status
```

### 2. Changer la catégorie

```
/setup category category:#nouvelle-categorie
```

Les prochaines parties utiliseront la nouvelle catégorie.

### 3. Activer les alertes monitoring

```
# 1. Créer un webhook dans un salon (ex: #bot-logs)
# 2. Copier l'URL du webhook
# 3. Configurer
/setup webhook url:https://discord.com/api/webhooks/xxxxx/yyyyyy

# 4. Vérifier
/setup status
```

### 4. Ajuster les règles

```
# Plus de joueurs
/setup rules min_players:8 max_players:15

# Vérifier
/setup status
```

### 5. Optimiser le monitoring

```
# Réduire la fréquence de collecte
/setup monitoring interval:180

# Économiser de la mémoire/CPU
# (collecte toutes les 3 minutes au lieu de 1)
```

---

## 🔧 Troubleshooting

| Problème | Solution |
|----------|----------|
| ❌ "Bot non configuré" | `/setup category` pour configurer la catégorie |
| ❌ "ConfigManager not initialized" | Attendre que le bot soit démarré (`clientReady`) |
| ⚠️ Configuration perdue | Vérifier que `data/werewolf.db` existe |
| ⚠️ Valeurs non mises à jour | `config.reload()` pour recharger |
| ❓ Voir toute la config | `/setup status` ou `config.getAll()` |

### Requêtes SQL utiles

```sql
-- Voir toutes les configurations
SELECT * FROM config;

-- Voir une valeur spécifique
SELECT value FROM config WHERE key = 'discord.category_id';

-- Réinitialiser (sauf schema_version)
DELETE FROM config WHERE key NOT IN ('schema_version');
```

---

## 🎨 Migration depuis les valeurs hardcodées

### Avant (hardcodé)

```javascript
// utils/validators.js
const CATEGORY_ID = '1469976287790633146';

// commands/create.js
const CATEGORY_ID = "1469976287790633146";

// index.js
const CATEGORY_ID = "1469976287790633146";
```

### Après (centralisé)

```javascript
const ConfigManager = require('./utils/config');
const config = ConfigManager.getInstance();
const categoryId = config.getCategoryId();

if (!categoryId) {
  // Gérer le cas non configuré
}
```

### Fichiers migrés

- ✅ `utils/validators.js`
- ✅ `commands/create.js`
- ✅ `index.js`

---

## ✅ Bonnes pratiques

### À faire ✅

1. **Utiliser les méthodes typées**
   ```javascript
   config.getCategoryId() // ✅ Bon
   config.get('discord.category_id') // ⚠️ Moins bien
   ```

2. **Vérifier les valeurs nulles**
   ```javascript
   const categoryId = config.getCategoryId();
   if (!categoryId) {
     throw new Error('Not configured');
   }
   ```

3. **Utiliser `/setup` depuis Discord**
   ```
   /setup category
   /setup status
   ```

### À éviter ❌

1. **Ne pas hardcoder**
   ```javascript
   const CATEGORY_ID = "1469976287790633146"; // ❌
   ```

2. **Ne pas modifier la DB directement**
   ```javascript
   db.run("UPDATE config..."); // ❌
   config.set(key, value); // ✅
   ```

3. **Ne pas ignorer les erreurs de setup**
   ```javascript
   const id = config.getCategoryId() || "default"; // ❌
   ```

---

## 📈 Avantages

✅ **Plus de valeurs hardcodées** : Tout est configurable  
✅ **Configuration depuis Discord** : Pas besoin d'éditer le code  
✅ **Validation automatique** : Détection du setup incomplet  
✅ **Cache performant** : <1ms pour obtenir une valeur  
✅ **Persistance SQLite** : Configuration sauvegardée entre redémarrages  
✅ **API simple** : Méthodes typées et claires  
✅ **Extensible** : Facile d'ajouter de nouvelles configurations  

---

## 📚 Documentation Complète

**Voir [CONFIG.md](CONFIG.md)** pour :
- Guide complet de toutes les commandes
- API Reference détaillée
- Exemples de code avancés
- Structure de la table SQL
- Troubleshooting approfondi

---

## 🎉 Résultat

Un bot Discord avec **configuration centralisée** :

- ⚙️ Configuration interactive depuis Discord
- 💾 Sauvegarde automatique dans SQLite
- ✅ Validation au démarrage
- 📊 Gestion unifiée de tous les paramètres
- 🚀 Plus besoin de modifier le code

**Bot professionnel = Bot configurable** 🎯

---

**Made with ❤️ for Werewolf Bot v2.2.0**
