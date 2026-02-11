# 📊 Monitoring & Alertes - Résumé Exécutif

> **TL;DR** : Système complet de monitoring temps réel avec alertes automatiques via webhook Discord. Dashboard admin avec métriques visuelles et historique 24h en SQLite.

## 🎯 Que fait le monitoring ?

**Visibilité opérationnelle 360° :**
- 📈 Collecte automatique toutes les 60s (système, Discord, parties, commandes, erreurs)
- 🚨 Alertes webhook Discord pour problèmes critiques (mémoire, latence, erreurs)
- 📊 Dashboard admin `/monitoring` avec barres de progression et graphiques ASCII
- 💾 Historique 24h stocké en SQLite pour analyse des tendances
- 🔍 Health checks automatiques avec statut global (HEALTHY/DEGRADED/UNHEALTHY)

## ⚡ Quick Start

### 1. Configurer le webhook (optionnel)

```env
# .env
MONITORING_WEBHOOK_URL=https://discord.com/api/webhooks/xxxxx/yyyyyy
```

**Créer webhook :**
1. Paramètres serveur → Intégrations → Webhooks
2. Nouveau webhook → Choisir salon `#bot-monitoring`
3. Copier URL → Ajouter dans `.env`

### 2. Utiliser le dashboard

```
/monitoring dashboard    # Métriques complètes
/monitoring health       # Statut de santé + recommandations
/monitoring alerts stats # Statistiques des alertes
/monitoring history      # Graphiques 24h
```

### 3. C'est tout !

Le monitoring démarre automatiquement au lancement du bot. Aucune configuration supplémentaire requise.

---

## 📊 Métriques Collectées

### 5 catégories surveillées :

| Catégorie | Métriques | Seuils |
|-----------|-----------|--------|
| **💻 Système** | Mémoire (%, MB), CPU (%), Uptime | 🔴 Mémoire >90% |
| **📡 Discord** | Guilds, Users, Latency, WebSocket | 🔴 Latency >500ms |
| **🎮 Parties** | Actives, Joueurs, Créées/Terminées 24h | - |
| **🔨 Commandes** | Total, Erreurs, Rate limited, Temps moy. | 🔴 Erreurs >15% |
| **⚠️ Erreurs** | Total, Critical, Warnings, Last 24h | - |

---

## 🚨 Alertes Automatiques

### 6 types d'alertes avec cooldowns intelligents :

```javascript
{
  highMemory: { seuil: 85%, cooldown: 5min },      // 🟡 Orange
  highLatency: { seuil: 500ms, cooldown: 5min },   // 🟡 Orange
  highErrorRate: { seuil: 15%, cooldown: 10min },  // 🔴 Rouge
  criticalError: { cooldown: 1min },               // 🔴 Rouge foncé
  botDisconnected: { cooldown: 1min },             // 🔴 Rouge foncé
  rateLimitAbuse: { seuil: 10, cooldown: 5min }    // 🟡 Orange
}
```

**Exemple d'alerte :**

```
🚨 Mémoire élevée
L'utilisation mémoire a atteint un niveau critique.

💾 Utilisation: 89%
📊 Détails: 911MB / 1024MB
⚠️ Seuil: 85%
```

### Cooldowns = Zéro spam

Les alertes ont des cooldowns pour éviter les notifications répétées :
- **5 minutes** : Mémoire, latence, rate limit abuse
- **10 minutes** : Taux d'erreur élevé
- **1 minute** : Erreurs critiques, déconnexions

---

## 📊 Dashboard `/monitoring`

### 4 sous-commandes :

#### `dashboard` - Vue complète

```
📊 Dashboard de Monitoring
Statut global: 🟢 HEALTHY

💻 Système
Mémoire: ████████░░ 82%
└─ 836MB / 1024MB
CPU: ███░░░░░░░ 12%
Uptime: 2j 14h

📡 Discord                🎮 Parties
Serveurs: 1                Actives: 3
Utilisateurs: 1,234       Joueurs: 18
Latence: 78ms             Créées (24h): 15
WebSocket: 🟢 Connecté    Terminées (24h): 12

🔨 Commandes
Total: 1,523
Erreurs: 12 (0.8%)
Rate limited: 45
Temps moy.: 156ms
```

#### `health` - Statut détaillé

```
🟢 Statut de santé
Tous les systèmes fonctionnent normalement

✅ Vérifications
• Mémoire: OK
• Latence: OK
• WebSocket: OK
• Taux d'erreur: OK
```

Si problèmes :

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

#### `alerts <action>` - Gérer alertes

```
/monitoring alerts stats    # Statistiques
/monitoring alerts enable   # Activer
/monitoring alerts disable  # Désactiver
```

#### `history` - Graphiques 24h

```
📈 Historique des métriques (24h)

💾 Mémoire: Moy. 78.2%, Pic 89.1%
📡 Latence: Moy. 92ms, Pic 312ms
⚡ Temps de réponse: Moy. 145ms

📊 Graphique mémoire (ASCII)
```

---

## 🏗️ Architecture

```
Bot Discord
    │
    ├─ MetricsCollector (collecte toutes les 60s)
    │   ├─ Système: mémoire, CPU, uptime
    │   ├─ Discord: latency, guilds, users
    │   ├─ Parties: actives, joueurs, stats 24h
    │   ├─ Commandes: total, erreurs, temps moy.
    │   └─ Erreurs: total, critical, warnings
    │
    ├─ AlertSystem (notifications webhook)
    │   ├─ Vérifie seuils automatiquement
    │   ├─ Cooldowns anti-spam
    │   └─ Embeds formatés avec couleurs
    │
    ├─ /monitoring (dashboard admin)
    │   ├─ Visualisations ASCII
    │   ├─ Statut de santé
    │   └─ Historique graphique
    │
    └─ SQLite (historique 24h)
        └─ Table metrics + Vue metrics_24h
```

---

## 💾 Base de Données

### Table `metrics`

Stocke un snapshot toutes les heures :

```sql
CREATE TABLE metrics (
  -- Métriques système
  memory_used, memory_total, memory_percentage,
  cpu_usage, uptime,
  
  -- Métriques Discord
  guilds, users, channels, latency, ws_status,
  
  -- Métriques jeux
  active_games, total_players,
  games_created_24h, games_completed_24h,
  
  -- Métriques commandes
  commands_total, commands_errors,
  commands_rate_limited, commands_avg_response_time,
  
  -- Métriques erreurs
  errors_total, errors_critical,
  errors_warnings, errors_last_24h,
  
  -- Santé
  health_status, health_issues,
  collected_at
);
```

### Requêtes utiles

```sql
-- Moyenne mémoire sur 1 heure
SELECT AVG(memory_percentage) FROM metrics
WHERE collected_at >= strftime('%s', 'now', '-1 hour');

-- Pics de latence aujourd'hui
SELECT MAX(latency), datetime(collected_at, 'unixepoch')
FROM metrics
WHERE collected_at >= strftime('%s', 'now', 'start of day')
GROUP BY date(collected_at, 'unixepoch');
```

---

## 🚀 Exemples d'Utilisation

### En production

```javascript
// Automatique au démarrage (index.js)
MetricsCollector.initialize(client);
AlertSystem.initialize(webhookUrl);

const metrics = MetricsCollector.getInstance();
metrics.startCollection(60000); // 60s

// Collecte automatique toutes les 60s
// Alertes automatiques si seuils dépassés
```

### Dans votre code

```javascript
// Enregistrer une commande (déjà intégré automatiquement)
const startTime = Date.now();
// ... exécution ...
metrics.recordCommand('start', Date.now() - startTime, true);

// Enregistrer une erreur
try {
  // ... code ...
} catch (error) {
  metrics.recordError('error'); // 'error' | 'critical' | 'warning'
}

// Événements de jeu (déjà intégré dans gameManager)
metrics.recordGameCreated();
metrics.recordGameCompleted();
```

### Vérifier manuellement

```javascript
const health = metrics.getHealthStatus();
// => { status: 'HEALTHY', issues: [] }

if (health.status === 'UNHEALTHY') {
  console.error('Problems:', health.issues);
  // => ['Haute utilisation mémoire: 92%', 'Latence élevée: 612ms']
}
```

---

## 🎨 Personnalisation

### Changer les seuils d'alerte

`monitoring/alerts.js` :

```javascript
this.rules = {
  highMemory: { threshold: 90, cooldown: 600000 },    // 90% seuil, 10min cooldown
  highLatency: { threshold: 300, cooldown: 300000 },  // 300ms seuil
  highErrorRate: { threshold: 20, cooldown: 600000 }, // 20% seuil
  // ...
};
```

### Changer l'intervalle de collecte

`index.js` :

```javascript
metrics.startCollection(30000); // 30 secondes au lieu de 60
```

### Désactiver les alertes temporairement

```
/monitoring alerts disable
```

---

## 🔧 Troubleshooting

| Problème | Solution |
|----------|----------|
| ❌ Alertes non reçues | Vérifier `MONITORING_WEBHOOK_URL` dans `.env` |
| ❌ `/monitoring` ne répond pas | Vérifier permissions admin sur Discord |
| ⚠️ Mémoire qui augmente | Historique auto-nettoyé (max 24 points) |
| ⚠️ Latence toujours élevée | Réduire intervalle à 120s : `startCollection(120000)` |

### Tester le webhook

```javascript
const alerts = AlertSystem.getInstance();
await alerts.sendAlert('Test', 'Message de test', 'info');
```

---

## 📈 Commandes Utiles

```bash
# Consulter les métriques en DB (SQLite CLI)
sqlite3 data/werewolf.db "SELECT * FROM metrics ORDER BY collected_at DESC LIMIT 10;"

# Moyenne mémoire de la dernière heure
sqlite3 data/werewolf.db "SELECT AVG(memory_percentage) FROM metrics WHERE collected_at >= strftime('%s', 'now', '-1 hour');"

# Santé actuelle
sqlite3 data/werewolf.db "SELECT health_status, health_issues FROM metrics ORDER BY collected_at DESC LIMIT 1;"
```

---

## 🎯 Cas d'Usage

### 1. Détection de memory leak

Le monitoring détecte automatiquement si la mémoire augmente progressivement :

```
🚨 Mémoire élevée
L'utilisation mémoire a atteint un niveau critique.

💾 Utilisation: 92%
📊 Détails: 942MB / 1024MB
⚠️ Seuil: 85%
```

**Action** : Redémarrer le bot ou analyser les parties actives

### 2. Problème Discord API

Si Discord a des problèmes :

```
🚨 Latence élevée
La latence Discord API est anormalement élevée.

⏱️ Latence actuelle: 1234ms
⚠️ Seuil: 500ms
📡 Impact: Commandes ralenties
```

**Action** : Vérifier status.discord.com

### 3. Spam/abus détecté

```
🚨 Abus de rate limiting détecté
Un utilisateur tente de spam les commandes.

👤 Utilisateur: @BadUser
🔨 Commande: start
⚠️ Violations: 15
🛡️ Action: Ban temporaire appliqué
```

### 4. Bot planté et redémarré

```
✅ Bot démarré
Le bot Werewolf a démarré avec succès.

📦 Version: 2.1.0
⏱️ Uptime précédent: 3j 14h 25m
✅ Statut: En ligne
```

### 5. Résumé quotidien

```
📊 Résumé quotidien
Statistiques des dernières 24 heures.

🎮 Parties: 42 créées, 38 terminées
🔨 Commandes: 3,456 (23 erreurs)
⚠️ Erreurs: 45
🛡️ Rate limits: 123
📊 Latence moy.: 87ms
💾 Mémoire moy.: 76%
⏱️ Uptime: 1j 2h
```

---

## 🌟 Avantages

✅ **Proactif** : Détection avant que les utilisateurs ne se plaignent  
✅ **Automatique** : Zéro configuration après setup initial  
✅ **Visuel** : Dashboard avec graphiques ASCII intuitifs  
✅ **Intelligent** : Cooldowns évitent le spam d'alertes  
✅ **Complet** : Couvre tous les aspects du bot (système, Discord, jeu, commandes, erreurs)  
✅ **Léger** : <1% CPU, <5MB RAM  
✅ **Extensible** : Facile d'ajouter de nouvelles métriques  

---

## 📚 Documentation Complète

**Voir [MONITORING.md](MONITORING.md)** pour :
- Architecture détaillée
- Configuration avancée
- API Reference complète
- Exemples de code
- Requêtes SQL utiles
- Troubleshooting approfondi

---

## 🎉 Résultat

Un bot Discord avec **visibilité opérationnelle complète** :

- 📊 Savoir exactement ce qui se passe en temps réel
- 🚨 Être notifié immédiatement des problèmes
- 🔍 Analyser les tendances sur 24h
- 💡 Recevoir des recommandations automatiques
- 📈 Prendre des décisions data-driven

**Bot en production = Bot monitoré** 🎯

---

**Made with ❤️ for Werewolf Bot v2.1.0**
