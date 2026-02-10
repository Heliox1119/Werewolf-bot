# Tests - Werewolf Bot

Ce dossier contient tous les tests automatisés du bot.

## Structure

- `__mocks__/` : Mocks de modules externes (discord.js)
- `helpers/` : Fonctions utilitaires pour les tests
- `game/` : Tests unitaires du game logic
- `commands/` : Tests des commandes slash
- `integration/` : Tests d'intégration complets
- `setup.js` : Configuration globale des tests

## Lancer les tests

```bash
# Tous les tests
npm test

# Un fichier spécifique
npm test gameManager.test.js

# Mode watch
npm run test:watch

# Avec couverture
npm run test:coverage
```

## Ajouter un test

1. Créer un fichier `*.test.js` dans le bon dossier
2. Importer les helpers nécessaires
3. Écrire vos tests avec `describe` et `test`
4. Lancer `npm test` pour vérifier

Voir [TESTING.md](../TESTING.md) pour la documentation complète.
