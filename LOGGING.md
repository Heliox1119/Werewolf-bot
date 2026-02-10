# 📋 Système de Logging

Le bot utilise un système de logging centralisé avec niveaux, couleurs et timestamps.

## 🎯 Niveaux de Log

### DEBUG (Niveau 0)
- **Usage** : Détails techniques, timers, états internes
- **Quand** : Uniquement pour debug approfondi
- **Couleur** : Gris
- **Exemples** :
  ```
  [2026-02-09T16:39:44.113Z] [DEBUG] [GAME] Creating village channel...
  [2026-02-09T16:39:44.250Z] [DEBUG] [COMMANDS] Category check and defer successful
  [2026-02-09T16:39:45.100Z] [DEBUG] [GAME] Timer [createInitialChannels] {"duration":"987ms"}
  ```

### INFO (Niveau 1) - **Par défaut**
- **Usage** : Événements normaux, flux principal
- **Quand** : Production normale
- **Couleur** : Bleu
- **Exemples** :
  ```
  [2026-02-09T16:39:44.113Z] [INFO] [APP] Loading saved game state...
  [2026-02-09T16:39:44.420Z] [INFO] [GAME] Starting game creation
  [2026-02-09T16:39:45.800Z] [INFO] [GAME] Cleaning up game channels...
  ```

### SUCCESS (sous-niveau de INFO)
- **Usage** : Opérations réussies
- **Couleur** : Vert
- **Exemples** :
  ```
  [2026-02-09T16:39:44.113Z] [SUCCESS] [APP] 🐺 Connected as WerewolfBot#1234
  [2026-02-09T16:39:44.800Z] [SUCCESS] [GAME] ✅ Village channel created
  [2026-02-09T16:39:45.900Z] [SUCCESS] [GAME] ✅ Game creation completed
  ```

### WARN (Niveau 2)
- **Usage** : Problèmes non-critiques, comportements inhabituels
- **Quand** : Dégradations mineures
- **Couleur** : Jaune
- **Exemples** :
  ```
  [2026-02-09T16:39:44.500Z] [WARN] [GAME] Channel not found, skipping
  [2026-02-09T16:39:44.600Z] [WARN] [COMMANDS] Category check failed
  [2026-02-09T16:39:44.700Z] [WARN] [GAME] Ignored non-guild member for wolves permissions
  ```

### ERROR (Niveau 3)
- **Usage** : Erreurs récupérables, échecs d'opérations
- **Quand** : Problèmes nécessitant attention
- **Couleur** : Rouge
- **Exemples** :
  ```
  [2026-02-09T16:39:44.800Z] [ERROR] [GAME] ❌ Failed to create initial channels
  {
    "message": "Missing Permissions",
    "code": 50013,
    "stack": "Error: Missing Permissions\n    at ..."
  }
  ```

### CRITICAL (sous-niveau d'ERROR)
- **Usage** : Erreurs fatales, crashes imminents
- **Quand** : Problèmes critiques système
- **Couleur** : Rouge sur fond rouge (bold)
- **Exemples** :
  ```
  [2026-02-09T16:39:44.900Z] [CRITICAL] [APP] Uncaught Exception
  [2026-02-09T16:39:45.000Z] [CRITICAL] [APP] Discord client error
  ```

## ⚙️ Configuration

### Variable d'Environnement

Ajouter dans `.env` :

```env
# Niveaux possibles : DEBUG, INFO, WARN, ERROR, NONE
LOG_LEVEL=INFO
```

### Niveaux Disponibles

| Niveau  | Valeur | Affiche                        |
|---------|--------|--------------------------------|
| DEBUG   | 0      | Tout (debug + info + warn + error) |
| INFO    | 1      | info + success + warn + error  |
| WARN    | 2      | warn + error uniquement        |
| ERROR   | 3      | error + critical uniquement    |
| NONE    | 4      | Rien (désactive les logs)      |

### Recommandations

- **Développement** : `LOG_LEVEL=DEBUG`
- **Production** : `LOG_LEVEL=INFO`
- **Troubleshooting** : `LOG_LEVEL=DEBUG`
- **Performance critique** : `LOG_LEVEL=WARN`

## 🔧 Utilisation dans le Code

### Import du Logger

```javascript
// Import logger spécifique à un module
const { game: logger } = require('../utils/logger');

// Ou créer un logger custom
const { createLogger } = require('../utils/logger');
const logger = createLogger('MY_MODULE');
```

### Loggers Pré-configurés

```javascript
const { 
  app,           // Logger général application
  game,          // Logger game manager
  commands,      // Logger commandes
  voice,         // Logger voice/audio
  interaction,   // Logger interactions Discord
  discord        // Logger Discord API
} = require('../utils/logger');
```

### Méthodes Disponibles

```javascript
// Logs simples
logger.debug('Message de debug');
logger.info('Opération en cours');
logger.success('✅ Réussite !');
logger.warn('⚠️ Attention');
logger.error('❌ Erreur');
logger.critical('💥 Critique !');

// Logs avec données structurées
logger.info('Player joined', { 
  playerId: '123456',
  username: 'Player1',
  gameId: 'abc' 
});

// Logs d'erreur avec stack trace
try {
  // ...
} catch (error) {
  logger.error('Operation failed', error);
}

// Timer de performance
const timer = logger.startTimer('operationName');
// ... code ...
timer.end(); // Affiche: Timer [operationName] {"duration":"42ms"}
```

### Méthodes Spécialisées

```javascript
// Log interaction Discord
logger.logInteraction(interaction, 'button_click');

// Log changement d'état jeu
logger.logGameState(channelId, 'DAY', 'VOTE', 7);

// Log activité vocale
logger.logVoice('mute', channelId, { userId: '123' });

// Log appel API
logger.logAPI('GET', '/channels/123', 200, 150);
```

## 📊 Exemples de Sortie

### Mode DEBUG

```
[2026-02-09T16:39:44.113Z] [DEBUG] [COMMANDS] Category check and defer successful {"channelId":"123","command":"create"}
[2026-02-09T16:39:44.200Z] [INFO] [GAME] Starting game creation {"channelId":"123","user":"Player1"}
[2026-02-09T16:39:44.250Z] [DEBUG] [GAME] Creating village channel...
[2026-02-09T16:39:44.500Z] [SUCCESS] [GAME] ✅ Village channel created {"id":"456"}
[2026-02-09T16:39:45.000Z] [DEBUG] [GAME] Timer [createInitialChannels] {"duration":"800ms"}
[2026-02-09T16:39:45.100Z] [SUCCESS] [GAME] ✅ Game creation completed {"channelId":"123"}
```

### Mode INFO (Production)

```
[2026-02-09T16:39:44.113Z] [SUCCESS] [APP] 🐺 Connected as WerewolfBot#1234
[2026-02-09T16:39:44.200Z] [INFO] [GAME] Starting game creation {"channelId":"123","user":"Player1"}
[2026-02-09T16:39:44.500Z] [SUCCESS] [GAME] ✅ All initial channels created successfully {"channelCount":6}
[2026-02-09T16:39:45.100Z] [SUCCESS] [GAME] ✅ Game creation completed {"channelId":"123"}
```

### Mode WARN (Compact)

```
[2026-02-09T16:39:44.500Z] [WARN] [GAME] Channel not found, skipping {"name":"wolves","id":"789"}
[2026-02-09T16:39:44.600Z] [ERROR] [INTERACTION] Failed to defer interaction
{
  "message": "Unknown interaction",
  "code": 10062
}
```

## 🎨 Avantages du Système

✅ **Centralisé** - Un seul point de configuration  
✅ **Structuré** - Données JSON pour parsing  
✅ **Coloré** - Lecture facile en terminal  
✅ **Filtrable** - Niveaux configurables  
✅ **Performance** - Timers intégrés  
✅ **Debug** - Stack traces complètes  
✅ **Production** - Logs compacts en INFO  

## 🚀 Migration

### Avant

```javascript
console.log('[create] Starting game...');
console.error('Error:', err.message);
```

### Après

```javascript
const { commands: logger } = require('../utils/logger');

logger.info('Starting game creation', { channelId });
logger.error('Failed to create game', error);
```

## 📝 Bonnes Pratiques

1. **Utiliser le bon niveau**
   - DEBUG pour détails techniques
   - INFO pour flux normal
   - WARN pour problèmes mineurs
   - ERROR pour échecs

2. **Inclure du contexte**
   ```javascript
   // ❌ Mauvais
   logger.error('Failed');
   
   // ✅ Bon
   logger.error('Failed to create channel', { 
     channelName: 'wolves',
     error: err.message 
   });
   ```

3. **Logger les succès critiques**
   ```javascript
   logger.success('✅ Game started', { playerCount: 7 });
   ```

4. **Utiliser les timers pour performances**
   ```javascript
   const timer = logger.startTimer('operation');
   await longOperation();
   timer.end(); // Affiche la durée
   ```

5. **Ne pas logger de données sensibles**
   ```javascript
   // ❌ Mauvais
   logger.debug('Token:', process.env.TOKEN);
   
   // ✅ Bon
   logger.debug('Token loaded', { length: process.env.TOKEN.length });
   ```

---

**Version** : 2.0.0  
**Dernière mise à jour** : 2026-02-09
