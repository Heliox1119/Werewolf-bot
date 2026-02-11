# 📊 Monitoring & Alertes - Werewolf Bot

Documentation complète du système de monitoring et d'alertes du bot Werewolf.

## 📋 Table des matières

- [Vue d'ensemble](#vue-densemble)
- [Architecture](#architecture)
- [Métriques collectées](#métriques-collectées)
- [Système d'alertes](#système-dalertes)
- [Commande /monitoring](#commande-monitoring)
- [Configuration](#configuration)
- [Base de données](#base-de-données)
- [Utilisation](#utilisation)
- [Troubleshooting](#troubleshooting)

---

## 🎯 Vue d'ensemble

Le système de monitoring fournit une visibilité opérationnelle complète sur le bot Werewolf :

- **📈 Collecte de métriques** : Système, Discord, parties, commandes, erreurs
- **🚨 Alertes automatiques** : Notifications webhook Discord pour les problèmes critiques
- **📊 Dashboard admin** : Commande `/monitoring` avec visualisations en temps réel
- **💾 Historique** : Stockage SQLite des métriques sur 24 heures
- **🔍 Santé du bot** : Statut global avec détection des problèmes

### Fonctionnalités clés

✅ Monitoring temps réel (collecte automatique toutes les 60s)  
✅ Alertes intelligentes avec cooldown (évite le spam)  
✅ Dashboard visuel avec barres de progression et graphiques ASCII  
✅ Historique 24h pour analyse des tendances  
✅ Health checks automatiques (mémoire, latence, erreurs)  
✅ Intégration transparente avec le bot

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Bot Discord                               │
│  ┌────────────────────────────────────────────────────────┐      │
│  │               index.js (orchestration)                  │      │
│  └────────────┬───────────────────────┬────────────────────┘      │
│               │                       │                           │
│    ┌──────────▼──────────┐ ┌─────────▼──────────┐                │
│    │  MetricsCollector   │ │   AlertSystem      │                │
│    │  (collecte données)  │ │  (notifications)  │                │
│    └──────┬──────────────┘ └─────────┬──────────┘                │
│           │                           │                           │
│           │  ┌────────────────────────▼──────────┐                │
│           │  │    Discord Webhook                 │                │
│           │  │    (alertes critiques)             │                │
│           │  └────────────────────────────────────┘                │
│           │                                                        │
│    ┌──────▼──────────┐                                            │
│    │   /monitoring   │                                            │
│    │   (dashboard)   │                                            │
│    └─────────────────┘                                            │
│           │                                                        │
│    ┌──────▼──────────┐                                            │
│    │  SQLite metrics │                                            │
│    │  (historique)   │                                            │
│    └─────────────────┘                                            │
└──────────────────────────────────────────────────────────────────┘
```

### Composants

#### 1. **MetricsCollector** (`monitoring/metrics.js`)
- Singleton pattern avec `initialize(client)` et `getInstance()`
- Collecte automatique toutes les 60 secondes
- Historique 24h en rolling window
- Health status calculation

#### 2. **AlertSystem** (`monitoring/alerts.js`)
- Webhook Discord pour notifications
- Cooldowns configurables par type d'alerte
- Embeds formatés avec couleurs
- Statistiques d'alertes

#### 3. **Commande /monitoring** (`commands/monitoring.js`)
- 4 sous-commandes : `dashboard`, `health`, `alerts`, `history`
- Visualisations ASCII (barres de progression, graphiques)
- Admin-only (permission requise)

#### 4. **Base de données** (`database/schema.sql`)
- Table `metrics` : stockage historique
- Vue `metrics_24h` : requêtes rapides
- Indexes optimisés

---

## 📊 Métriques collectées

### 1. Système (`system`)

```javascript
{
  memory: {
    used: 450,        // Mo
    total: 1024,      // Mo
    percentage: 43.9  // %
  },
  cpu: 12.5,          // %
  uptime: 86400       // secondes
}
```

**Seuils d'alerte :**
- 🟢 HEALTHY : < 85%
- 🟡 DEGRADED : 85-90%
- 🔴 UNHEALTHY : > 90%

### 2. Discord (`discord`)

```javascript
{
  guilds: 1,
  users: 1234,
  channels: 56,
  latency: 78,           // ms
  wsStatus: 'READY'      // WebSocket status
}
```

**Seuils d'alerte :**
- 🟢 HEALTHY : < 200ms
- 🟡 DEGRADED : 200-500ms
- 🔴 UNHEALTHY : > 500ms

### 3. Parties (`game`)

```javascript
{
  activeGames: 3,
  totalPlayers: 18,
  gamesCreated24h: 15,
  gamesCompleted24h: 12
}
```

### 4. Commandes (`commands`)

```javascript
{
  total: 1523,
  errors: 12,
  rateLimited: 45,
  avgResponseTime: 156  // ms (rolling average 100 dernières)
}
```

**Taux d'erreur :**
- 🟢 HEALTHY : < 5%
- 🟡 DEGRADED : 5-15%
- 🔴 UNHEALTHY : > 15%

### 5. Erreurs (`errors`)

```javascript
{
  total: 234,
  critical: 5,
  warnings: 229,
  last24h: 18
}
```

---

## 🚨 Système d'alertes

### Types d'alertes

#### 1. **Mémoire élevée** (`highMemory`)
- **Seuil :** 85%
- **Cooldown :** 5 minutes
- **Couleur :** 🟡 Orange (warning)

```javascript
await alerts.alertHighMemory(memoryPercentage, memoryUsed, memoryTotal);
```

#### 2. **Latence élevée** (`highLatency`)
- **Seuil :** 500ms
- **Cooldown :** 5 minutes
- **Couleur :** 🟡 Orange (warning)

#### 3. **Taux d'erreur élevé** (`highErrorRate`)
- **Seuil :** 15%
- **Cooldown :** 10 minutes
- **Couleur :** 🔴 Rouge (error)

#### 4. **Erreur critique** (`criticalError`)
- **Cooldown :** 1 minute
- **Couleur :** 🔴 Rouge foncé (critical)
- Inclut stack trace et contexte

#### 5. **Bot déconnecté** (`botDisconnected`)
- **Cooldown :** 1 minute
- **Couleur :** 🔴 Rouge foncé (critical)

#### 6. **Abus rate limiting** (`rateLimitAbuse`)
- **Seuil :** 10 violations
- **Cooldown :** 5 minutes
- **Couleur :** 🟡 Orange (warning)

### Cooldowns

Les cooldowns évitent le spam d'alertes :

```javascript
rules: {
  highMemory: { threshold: 85, cooldown: 300000 },    // 5min
  highLatency: { threshold: 500, cooldown: 300000 },  // 5min
  highErrorRate: { threshold: 15, cooldown: 600000 }, // 10min
  criticalError: { cooldown: 60000 },                 // 1min
  botDisconnected: { cooldown: 60000 },               // 1min
  rateLimitAbuse: { threshold: 10, cooldown: 300000 } // 5min
}
```

### Vérification automatique

Le système vérifie automatiquement les métriques :

```javascript
const alerts = AlertSystem.getInstance();
const metrics = MetricsCollector.getInstance();

// Vérifie et envoie des alertes si nécessaire
const alertsSent = await alerts.checkMetrics(metrics.getMetrics());
// => ['highMemory', 'highLatency']
```

---

## 📊 Commande /monitoring

### Sous-commandes

#### `/monitoring dashboard`

Dashboard complet avec toutes les métriques :

```
📊 Dashboard de Monitoring
Statut global: 🟢 HEALTHY

💻 Système
Mémoire: ████████░░ 82%
└─ 836MB / 1024MB
CPU: ███░░░░░░░ 12%
Uptime: 2j 14h 32m

📡 Discord
Serveurs: 1
Utilisateurs: 1,234
Latence: 78ms
WebSocket: 🟢 Connecté

🎮 Parties
Actives: 3
Joueurs: 18
Créées (24h): 15
Terminées (24h): 12

🔨 Commandes
Total: 1,523
Erreurs: 12 (0.8%)
Rate limited: 45
Temps moy.: 156ms
```

#### `/monitoring health`

Statut de santé détaillé :

```
🟢 Statut de santé
Tous les systèmes fonctionnent normalement

✅ Vérifications
• Mémoire: OK
• Latence: OK
• WebSocket: OK
• Taux d'erreur: OK
```

Si problèmes détectés :

```
🟡 Statut de santé
Certaines métriques sont au-dessus des seuils normaux

⚠️ Problèmes
• Haute utilisation mémoire: 87%
• Latence élevée: 523ms

💡 Recommandations
• Redémarrer le bot pour libérer la mémoire
• Vérifier la connexion internet
```

#### `/monitoring alerts <action>`

Gère le système d'alertes :

**`stats`** : Statistiques des alertes
```
📊 Statistiques des alertes
📈 Total: 23

📊 Par type
highMemory: 8
highLatency: 3
highErrorRate: 2
criticalError: 10
```

**`enable`** : Active les alertes  
**`disable`** : Désactive les alertes

#### `/monitoring history`

Historique des métriques sur 24h :

```
📈 Historique des métriques (24h)
24 points de données

💾 Mémoire        📡 Latence        ⚡ Performance
Moyenne: 78.2%    Moyenne: 92ms     Temps de réponse moy.: 145ms
Pic: 89.1%        Pic: 312ms        Commandes totales: 1,523

📊 Graphique mémoire
```
Mémoire (12 dernières heures)

 90% ██ ██ █  ███
 75% █████████████
 60% █████████████
 45% █████████████
 30% █████████████
     ─────────────
     12h ago → now
```
```

---

## ⚙️ Configuration

### Variables d'environnement

Ajouter au fichier `.env` :

```env
# Webhook Discord pour les alertes (optionnel)
MONITORING_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxx/yyyyyy
```

### Créer un webhook Discord

1. Aller dans les paramètres du serveur → Intégrations
2. Créer un nouveau webhook
3. Choisir le salon pour les alertes (ex: `#bot-monitoring`)
4. Copier l'URL du webhook
5. Ajouter à `.env`

### Configuration des seuils

Modifier dans `monitoring/alerts.js` :

```javascript
this.rules = {
  highMemory: { threshold: 85, cooldown: 300000 },
  highLatency: { threshold: 500, cooldown: 300000 },
  highErrorRate: { threshold: 15, cooldown: 600000 },
  // ...
};
```

### Intervalle de collecte

Par défaut : 60 secondes. Modifier dans `index.js` :

```javascript
metrics.startCollection(30000); // 30 secondes
```

---

## 💾 Base de données

### Table `metrics`

```sql
CREATE TABLE metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Métriques système
  memory_used INTEGER NOT NULL,
  memory_total INTEGER NOT NULL,
  memory_percentage REAL NOT NULL,
  cpu_usage REAL NOT NULL,
  uptime INTEGER NOT NULL,
  
  -- Métriques Discord
  guilds INTEGER NOT NULL,
  users INTEGER NOT NULL,
  channels INTEGER NOT NULL,
  latency INTEGER NOT NULL,
  ws_status TEXT NOT NULL,
  
  -- Métriques jeux
  active_games INTEGER DEFAULT 0,
  total_players INTEGER DEFAULT 0,
  games_created_24h INTEGER DEFAULT 0,
  games_completed_24h INTEGER DEFAULT 0,
  
  -- Métriques commandes
  commands_total INTEGER DEFAULT 0,
  commands_errors INTEGER DEFAULT 0,
  commands_rate_limited INTEGER DEFAULT 0,
  commands_avg_response_time INTEGER DEFAULT 0,
  
  -- Métriques erreurs
  errors_total INTEGER DEFAULT 0,
  errors_critical INTEGER DEFAULT 0,
  errors_warnings INTEGER DEFAULT 0,
  errors_last_24h INTEGER DEFAULT 0,
  
  -- Statut de santé
  health_status TEXT NOT NULL,
  health_issues TEXT,
  
  -- Métadonnées
  collected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
```

### Vue `metrics_24h`

Vue optimisée pour les requêtes 24h :

```sql
CREATE VIEW metrics_24h AS
SELECT * FROM metrics
WHERE collected_at >= strftime('%s', 'now', '-1 day')
ORDER BY collected_at DESC;
```

### Requêtes utiles

**Métriques des dernières 24h :**
```sql
SELECT * FROM metrics_24h;
```

**Moyenne mémoire sur 1 heure :**
```sql
SELECT AVG(memory_percentage) as avg_memory
FROM metrics
WHERE collected_at >= strftime('%s', 'now', '-1 hour');
```

**Pics de latence :**
```sql
SELECT MAX(latency) as max_latency, 
       datetime(collected_at, 'unixepoch') as time
FROM metrics
WHERE collected_at >= strftime('%s', 'now', '-1 day')
GROUP BY date(collected_at, 'unixepoch');
```

---

## 🚀 Utilisation

### Démarrage automatique

Le monitoring démarre automatiquement au lancement du bot :

```javascript
// index.js
client.once("clientReady", async () => {
  // ...
  MetricsCollector.initialize(client);
  AlertSystem.initialize(webhookUrl);
  
  const metrics = MetricsCollector.getInstance();
  metrics.startCollection(60000);
  // ...
});
```

### Utilisation dans le code

#### Enregistrer une commande

```javascript
const startTime = Date.now();
// ... exécution commande ...
const responseTime = Date.now() - startTime;

const metrics = MetricsCollector.getInstance();
metrics.recordCommand('start', responseTime, true);
```

#### Enregistrer une erreur

```javascript
try {
  // ... code ...
} catch (error) {
  const metrics = MetricsCollector.getInstance();
  metrics.recordError('error'); // 'error' | 'critical' | 'warning'
}
```

#### Enregistrer un événement de jeu

```javascript
// Partie créée
metrics.recordGameCreated();

// Partie terminée
metrics.recordGameCompleted();
```

#### Vérifier la santé

```javascript
const metrics = MetricsCollector.getInstance();
const health = metrics.getHealthStatus();

if (health.status === 'UNHEALTHY') {
  console.error('Bot unhealthy:', health.issues);
}
```

#### Envoyer une alerte manuelle

```javascript
const alerts = AlertSystem.getInstance();

await alerts.alertCriticalError(error, {
  command: 'start',
  userId: '123456789'
});
```

---

## 🔧 Troubleshooting

### Problème : Alertes non reçues

**Cause :** Webhook non configuré ou invalide

**Solution :**
1. Vérifier `MONITORING_WEBHOOK_URL` dans `.env`
2. Tester le webhook :
   ```javascript
   const alerts = AlertSystem.getInstance();
   await alerts.sendAlert('Test', 'Test alert', 'info');
   ```
3. Vérifier les logs : `Alert system initialized with webhook`

### Problème : Métriques non collectées

**Cause :** Collecteur non initialisé

**Solution :**
1. Vérifier les logs au démarrage : `Monitoring system initialized`
2. Forcer la collecte manuelle :
   ```javascript
   const metrics = MetricsCollector.getInstance();
   await metrics.collect();
   ```

### Problème : Mémoire qui augmente constamment

**Cause :** Memory leak dans l'historique

**Solution :**
- Historique automatiquement nettoyé (max 24 points)
- Si persiste, vérifier `responseTimes` (max 100) et `history` (max 24)

### Problème : /monitoring ne répond pas

**Cause :** Permission insuffisante

**Solution :**
- Commande réservée aux administrateurs
- Vérifier les permissions Discord de l'utilisateur

### Problème : Latence élevée constante

**Causes possibles :**
1. Connexion internet du serveur
2. Discord API status (vérifier status.discord.com)
3. Serveur surchargé

**Solutions :**
- Réduire l'intervalle de collecte (ex: 120s au lieu de 60s)
- Optimiser les requêtes Discord (cache)

---

## 📚 API Reference

### MetricsCollector

```javascript
const MetricsCollector = require('./monitoring/metrics');

// Initialiser (une fois au démarrage)
MetricsCollector.initialize(client);

// Obtenir l'instance
const metrics = MetricsCollector.getInstance();

// Démarrer la collecte automatique
metrics.startCollection(intervalMs);

// Collecter manuellement
await metrics.collect();

// Enregistrer des événements
metrics.recordCommand(name, responseTime, success);
metrics.recordError(level);
metrics.recordGameCreated();
metrics.recordGameCompleted();
metrics.recordRateLimited();

// Obtenir les métriques
const current = metrics.getMetrics();
const history = metrics.getHistory();
const health = metrics.getHealthStatus();
```

### AlertSystem

```javascript
const AlertSystem = require('./monitoring/alerts');

// Initialiser
AlertSystem.initialize(webhookUrl);

// Obtenir l'instance
const alerts = AlertSystem.getInstance();

// Envoyer des alertes
await alerts.alertHighMemory(percentage, used, total);
await alerts.alertHighLatency(latency);
await alerts.alertHighErrorRate(rate, total, errors);
await alerts.alertCriticalError(error, context);
await alerts.alertBotDisconnected(reason);
await alerts.alertRateLimitAbuse(userId, command, violations);

// Vérifier les métriques automatiquement
await alerts.checkMetrics(metrics);

// Gérer l'état
alerts.setEnabled(true/false);
const stats = alerts.getAlertStats();
```

---

## 📈 Évolutions futures

- [ ] Dashboard web (Express server)
- [ ] Graphiques interactifs (Chart.js)
- [ ] Alertes par email (Nodemailer)
- [ ] Métriques personnalisées
- [ ] Export CSV des métriques
- [ ] Compression de l'historique (>30j)
- [ ] Prédiction de pannes (ML)
- [ ] Intégration Prometheus/Grafana

---

## 📝 Changelog

### v2.1.0 (2025-01-XX)
- ✨ Système de monitoring complet
- ✨ Alertes Discord webhook
- ✨ Commande `/monitoring` avec 4 sous-commandes
- ✨ Historique 24h en base de données
- ✨ Health checks automatiques

---

## 🤝 Contributing

Pour contribuer au système de monitoring :

1. Fork le projet
2. Créer une branche feature (`git checkout -b feature/monitoring-improvement`)
3. Commit les changements (`git commit -m 'Add: nouvelle métrique'`)
4. Push la branche (`git push origin feature/monitoring-improvement`)
5. Créer une Pull Request

---

## 📄 License

Voir [LICENSE](LICENSE) pour plus d'informations.

---

## 💬 Support

- Discord : Serveur Werewolf Bot
- Issues : GitHub Issues
- Email : [votre-email]

---

**Made with ❤️ for Werewolf Bot**
