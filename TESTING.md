# 🧪 Tests Automatisés - Werewolf Bot

## 📋 Vue d'ensemble

Ce bot dispose d'une suite de tests automatisés complète utilisant **Jest** pour assurer la qualité et la fiabilité du code.

### Couverture actuelle

- ✅ **Tests unitaires** : gameManager, rôles, phases
- ✅ **Tests d'intégration** : commandes, workflow complet
- ✅ **Mocks Discord.js** : simule l'API Discord sans connexion réelle
- ✅ **Helpers de test** : utilitaires réutilisables

## 🚀 Commandes rapides

```bash
# Lancer tous les tests
npm test

# Tests en mode watch (relance automatique)
npm run test:watch

# Tests avec couverture de code
npm run test:coverage

# Tests avec détails verbeux
npm run test:verbose
```

## 📁 Structure des tests

```
tests/
├── setup.js                    # Configuration globale
├── __mocks__/
│   └── discord.js             # Mock de Discord.js
├── helpers/
│   └── testHelpers.js         # Fonctions utilitaires
├── game/
│   ├── gameManager.test.js    # Tests gameManager (critique)
│   ├── roles.test.js          # Tests des rôles
│   └── phases.test.js         # Tests des phases
├── commands/
│   ├── create.test.js         # Tests commande /create
│   └── start.test.js          # Tests commande /start
└── integration/
    └── fullGame.test.js       # Tests partie complète
```

## 📖 Guide d'utilisation

### Écrire un nouveau test

#### 1. Test unitaire simple

```javascript
const gameManager = require('../../game/gameManager');

describe('Ma fonctionnalité', () => {
  test('fait ce que j\'attends', () => {
    const result = gameManager.monAction();
    
    expect(result).toBe(true);
  });
});
```

#### 2. Test avec mock d'interaction Discord

```javascript
const { createMockInteraction } = require('../helpers/testHelpers');

test('répond à une interaction', async () => {
  const interaction = createMockInteraction({
    commandName: 'test',
    channelId: 'ch-123',
    userId: 'user-456'
  });

  await maCommande.execute(interaction);

  expect(interaction.replied).toBe(true);
});
```

#### 3. Test avec partie de jeu

```javascript
const { createGameWithPlayers } = require('../helpers/testHelpers');

test('détecte la victoire des loups', () => {
  const game = createGameWithPlayers(5);
  
  // Tuer tous les villageois
  game.players
    .filter(p => p.role !== ROLES.WEREWOLF)
    .forEach(p => p.alive = false);

  const winner = gameManager.checkWinner(game);
  expect(winner).toBe('wolves');
});
```

### Helpers disponibles

| Helper | Usage |
|--------|-------|
| `createMockUser(id, username)` | Créer un utilisateur Discord |
| `createMockInteraction(options)` | Créer une interaction slash command |
| `createMockGuild(options)` | Créer une guilde avec channels |
| `createMockGame(options)` | Créer un objet game personnalisé |
| `createMockPlayer(options)` | Créer un joueur |
| `createGameWithPlayers(count, opts)` | Créer un jeu avec N joueurs |
| `assertValidGame(game)` | Vérifier qu'un game est valide |
| `assertValidPlayer(player)` | Vérifier qu'un joueur est valide |
| `waitFor(ms)` | Attendre X millisecondes (async) |
| `mockLogger()` | Mock du système de logs |

## 🎯 Scénarios de test couverts

### GameManager

- ✅ Création de partie
- ✅ Joueurs rejoignent/quittent
- ✅ Démarrage avec attribution rôles
- ✅ Détection victoire (loups/village/amoureux)
- ✅ Système de votes
- ✅ Actions nocturnes (kill, see, potion)
- ✅ Protection contre duplicates Discord
- ✅ Recherche de partie par channel

### Commandes

- ✅ `/create` : création lobby, channels, host auto
- ✅ `/start` : vérification joueurs, sélection rôles
- ✅ Gestion des erreurs (permissions, channels)

### Rôles & Phases

- ✅ Constants définis correctement
- ✅ Pas de doublons
- ✅ Logique rôles spéciaux
- ✅ Séquence phases nuit/jour

### Intégration

- ✅ Workflow complet de partie
- ✅ Scénario victoire loups
- ✅ Scénario victoire village
- ✅ Scénario victoire amoureux
- ✅ Cycle jour/nuit avec votes
- ✅ Parties simultanées

## 📊 Couverture de code

Seuils minimums configurés :

- **Branches** : 60%
- **Fonctions** : 60%
- **Lignes** : 60%
- **Statements** : 60%

Pour voir le rapport détaillé :

```bash
npm run test:coverage
# Ouvre coverage/lcov-report/index.html
```

## 🐛 Debugging des tests

### Test qui échoue

```bash
# Mode verbose
npm run test:verbose

# Test spécifique
npm test -- gameManager.test.js

# Avec logs de debug
VERBOSE=1 npm test
```

### Voir les logs pendant les tests

Par défaut, les `console.log` sont masqués. Pour les voir :

```bash
VERBOSE=1 npm test
```

### Test qui timeout

Si un test prend trop de temps :

```javascript
test('mon test long', async () => {
  // ...
}, 20000); // Timeout à 20 secondes
```

Ou dans `jest.config.js` :

```javascript
testTimeout: 20000
```

## ✨ Bonnes pratiques

### ✅ À FAIRE

1. **Tester les cas limites**
   ```javascript
   test('refuse si 0 joueur');
   test('fonctionne avec 1 joueur');
   test('fonctionne avec 100 joueurs');
   ```

2. **Isoler chaque test**
   ```javascript
   beforeEach(() => {
     // Reset état
     gameManager = new GameManager();
   });
   ```

3. **Noms descriptifs**
   ```javascript
   test('refuse de créer deux parties sur le même channel');
   // ✅ Clair
   
   test('test create');
   // ❌ Vague
   ```

4. **Un concept par test**
   ```javascript
   test('ajoute un joueur');
   test('refuse joueur déjà présent');
   // ✅ Séparé
   
   test('gère les joueurs');
   // ❌ Trop large
   ```

### ❌ À ÉVITER

1. **Tests dépendants**
   ```javascript
   // ❌ Test 2 dépend de Test 1
   test('créer partie', () => { gameManager.create('ch1'); });
   test('ajouter joueur', () => { gameManager.join('ch1', user); });
   ```

2. **Timings hardcodés**
   ```javascript
   await new Promise(r => setTimeout(r, 5000)); // ❌ Lent
   ```

3. **Ignorer les erreurs async**
   ```javascript
   test('test async', async () => { // ✅ async/await
     await maFonction();
   });
   ```

## 🔄 CI/CD Integration

Les tests peuvent être intégrés dans un pipeline :

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
      - run: npm run test:coverage
```

## 📚 Ressources

- [Documentation Jest](https://jestjs.io/)
- [Discord.js Guide](https://discordjs.guide/)
- [Mocking Guide](https://jestjs.io/docs/mock-functions)

## 🆘 Problèmes courants

### "Cannot find module"

```bash
npm install
```

### "Jest did not exit"

Il reste des timers/connexions actifs :

```javascript
afterEach(() => {
  jest.clearAllTimers();
});
```

### "Timeout exceeded"

Augmenter le timeout :

```javascript
jest.setTimeout(10000);
```

## 📈 Prochaines étapes

Tests à ajouter :

- [ ] Tests pour `/vote`, `/kill`, `/see`, `/potion`
- [ ] Tests pour `/love`, `/listen`, `/shoot`
- [ ] Tests du système vocal (mute/unmute)
- [ ] Tests du système audio (ambiance)
- [ ] Tests de sauvegarde/chargement d'état
- [ ] Tests de cleanup auto des lobbys
- [ ] Tests de performance (stress tests)
- [ ] Tests E2E avec vrai bot Discord (optionnel)

## 💡 Exemples rapides

### Tester une fonction simple

```javascript
test('calcule correctement', () => {
  expect(2 + 2).toBe(4);
});
```

### Tester une exception

```javascript
test('lance une erreur si invalide', () => {
  expect(() => {
    gameManager.join(null, user);
  }).toThrow();
});
```

### Tester un mock

```javascript
const mockFn = jest.fn(() => 'valeur');
mockFn();

expect(mockFn).toHaveBeenCalled();
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn).toHaveReturnedWith('valeur');
```

---

**Dernière mise à jour** : Février 2026  
**Mainteneur** : Werewolf Bot Team
