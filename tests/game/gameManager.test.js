const gameManagerModule = require('../../game/gameManager');
const { GameManager } = gameManagerModule;
const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const {
  createMockUser,
  createMockGuild,
  createMockGame,
  createMockPlayer,
  createGameWithPlayers,
  assertValidGame,
  cleanupTest
} = require('../helpers/testHelpers');
const fs = require('fs');

// Mock fs pour éviter l'écriture de fichiers pendant les tests
jest.mock('fs');

describe('GameManager', () => {
  let gameManager;

  beforeEach(() => {
    gameManager = new GameManager();
    fs.writeFileSync = jest.fn();
    fs.existsSync = jest.fn(() => false);
    fs.readFileSync = jest.fn(() => '{}');
  });

  afterEach(() => {
    cleanupTest();
  });

  describe('create()', () => {
    test('crée une nouvelle partie avec paramètres par défaut', () => {
      const result = gameManager.create('channel-123');

      expect(result).toBe(true);
      expect(gameManager.games.has('channel-123')).toBe(true);
      
      const game = gameManager.games.get('channel-123');
      assertValidGame(game);
      expect(game.players).toHaveLength(0);
      expect(game.rules.minPlayers).toBe(5);
      expect(game.rules.maxPlayers).toBe(10);
    });

    test('crée une partie avec paramètres personnalisés', () => {
      const result = gameManager.create('channel-456', { 
        minPlayers: 8, 
        maxPlayers: 15 
      });

      expect(result).toBe(true);
      const game = gameManager.games.get('channel-456');
      expect(game.rules.minPlayers).toBe(8);
      expect(game.rules.maxPlayers).toBe(15);
    });

    test('refuse de créer une partie si elle existe déjà', () => {
      gameManager.create('channel-123');
      const result = gameManager.create('channel-123');

      expect(result).toBe(false);
      expect(gameManager.games.size).toBe(1);
    });

    test('peut créer plusieurs parties sur différents channels', () => {
      gameManager.create('channel-1');
      gameManager.create('channel-2');
      gameManager.create('channel-3');

      expect(gameManager.games.size).toBe(3);
      expect(gameManager.games.has('channel-1')).toBe(true);
      expect(gameManager.games.has('channel-2')).toBe(true);
      expect(gameManager.games.has('channel-3')).toBe(true);
    });
  });

  describe('join()', () => {
    beforeEach(() => {
      gameManager.create('channel-test');
    });

    test('ajoute un joueur à la partie', () => {
      const user = createMockUser('user-1', 'Alice');
      const result = gameManager.join('channel-test', user);

      expect(result).toBe(true);
      const game = gameManager.games.get('channel-test');
      expect(game.players).toHaveLength(1);
      expect(game.players[0].id).toBe('user-1');
      expect(game.players[0].username).toBe('Alice');
    });

    test('refuse un joueur déjà dans la partie', () => {
      const user = createMockUser('user-1', 'Alice');
      gameManager.join('channel-test', user);
      const result = gameManager.join('channel-test', user);

      expect(result).toBe(false);
      expect(gameManager.games.get('channel-test').players).toHaveLength(1);
    });

    test('ajoute plusieurs joueurs différents', () => {
      const user1 = createMockUser('user-1', 'Alice');
      const user2 = createMockUser('user-2', 'Bob');
      const user3 = createMockUser('user-3', 'Charlie');

      gameManager.join('channel-test', user1);
      gameManager.join('channel-test', user2);
      gameManager.join('channel-test', user3);

      const game = gameManager.games.get('channel-test');
      expect(game.players).toHaveLength(3);
    });

    test('refuse si la partie n\'existe pas', () => {
      const user = createMockUser('user-1', 'Alice');
      const result = gameManager.join('channel-invalid', user);

      expect(result).toBe(false);
    });

    test('refuse si la partie a déjà démarré', () => {
      const game = gameManager.games.get('channel-test');
      game.phase = PHASES.DAY; // Partie démarrée (phase != NIGHT initial)
      
      const user = createMockUser('user-1', 'Alice');
      const result = gameManager.join('channel-test', user);

      expect(result).toBe(false);
    });
  });

  // Tests pour leave() - méthode pas encore implémentée
  // describe('leave()', () => { ... });

  describe('start()', () => {
    beforeEach(() => {
      gameManager.create('channel-test');
    });

    test('démarre une partie avec assez de joueurs', () => {
      // Ajouter 5 joueurs
      for (let i = 1; i <= 5; i++) {
        gameManager.join('channel-test', createMockUser(`user-${i}`, `Player${i}`));
      }

      const roles = [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.VILLAGER];
      const game = gameManager.start('channel-test', roles);

      expect(game).toBeDefined();
      expect(game.phase).toBe(PHASES.NIGHT); // Nuit
      expect(game.players.every(p => p.role)).toBe(true); // Tous ont un rôle
      expect(game.dayCount).toBeGreaterThanOrEqual(0); // Commence à 0 ou 1
    });

    test('attribue les rôles correctement', () => {
      for (let i = 1; i <= 5; i++) {
        gameManager.join('channel-test', createMockUser(`user-${i}`, `Player${i}`));
      }

      const roles = [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER];
      const game = gameManager.start('channel-test', roles);

      const assignedRoles = game.players.map(p => p.role).sort();
      const expectedRoles = roles.sort();
      expect(assignedRoles).toEqual(expectedRoles);
    });

    test('refuse si pas assez de joueurs', () => {
      gameManager.join('channel-test', createMockUser('user-1', 'Alice'));
      
      const game = gameManager.start('channel-test', [ROLES.WEREWOLF]);

      expect(game).toBeNull();
    });

    test('refuse si la partie n\'existe pas', () => {
      const game = gameManager.start('channel-invalid', []);

      expect(game).toBeNull();
    });

    test('accepte et ajuste si trop de rôles (tronque automatiquement)', () => {
      for (let i = 1; i <= 5; i++) {
        gameManager.join('channel-test', createMockUser(`user-${i}`, `Player${i}`));
      }

      const tooManyRoles = [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER];
      const game = gameManager.start('channel-test', tooManyRoles);

      // Start ajuste automatiquement en tronquant
      expect(game).not.toBeNull();
      expect(game.players).toHaveLength(5);
      expect(game.players.every(p => p.role)).toBe(true);
    });
  });

  describe('checkWinner()', () => {
    test('détecte victoire des loups (tous les villageois morts)', () => {
      const game = createGameWithPlayers(4, {
        roles: [ROLES.WEREWOLF, ROLES.VILLAGER, ROLES.VILLAGER, ROLES.SEER]
      });
      
      // Tuer tous les non-loups
      game.players[1].alive = false;
      game.players[2].alive = false;
      game.players[3].alive = false;

      const winner = gameManager.checkWinner(game);
      expect(winner).toBe('wolves');
    });

    test('détecte victoire du village (tous les loups morts)', () => {
      const game = createGameWithPlayers(4, {
        roles: [ROLES.WEREWOLF, ROLES.VILLAGER, ROLES.SEER, ROLES.WITCH]
      });
      
      // Tuer tous les loups
      game.players[0].alive = false;

      const winner = gameManager.checkWinner(game);
      expect(winner).toBe('village');
    });

    test('détecte victoire des amoureux', () => {
      const game = createGameWithPlayers(4, {
        roles: [ROLES.VILLAGER, ROLES.VILLAGER, ROLES.WEREWOLF, ROLES.SEER]
      });
      
      // Deux amoureux vivants, tous les autres morts
      game.players[0].inLove = true;
      game.players[1].inLove = true;
      game.players[2].alive = false;
      game.players[3].alive = false;
      game.lovers = [['player-0', 'player-1']];

      const winner = gameManager.checkWinner(game);
      expect(winner).toBe('lovers');
    });

    test('retourne null si la partie continue', () => {
      const game = createGameWithPlayers(5, {
        roles: [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.VILLAGER, ROLES.SEER, ROLES.WITCH]
      });

      const winner = gameManager.checkWinner(game);
      expect(winner).toBeNull();
    });
  });

  // Tests pour vote() - méthode pas encore implémentée
  // describe('vote()', () => { ... });

  // Tests pour killTarget() - méthode pas encore implémentée
  // describe('killTarget()', () => { ... });

  describe('isRecentDuplicate()', () => {
    test('détecte une commande dupliquée récente', () => {
      const isDup1 = gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      expect(isDup1).toBe(false);

      const isDup2 = gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      expect(isDup2).toBe(true);
    });

    test('autorise la même commande après 5 secondes', () => {
      jest.useFakeTimers();
      
      gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      
      jest.advanceTimersByTime(6000);
      
      const isDup = gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      expect(isDup).toBe(false);
      
      jest.useRealTimers();
    });

    test('différencie les commandes par channel', () => {
      gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      const isDup = gameManager.isRecentDuplicate('create', 'ch2', 'user1');

      expect(isDup).toBe(false);
    });

    test('différencie les commandes par utilisateur', () => {
      gameManager.isRecentDuplicate('create', 'ch1', 'user1');
      const isDup = gameManager.isRecentDuplicate('create', 'ch1', 'user2');

      expect(isDup).toBe(false);
    });
  });

  describe('getGameByChannelId()', () => {
    test('retourne une partie existante par channel principal', () => {
      gameManager.create('channel-main');
      const game = gameManager.getGameByChannelId('channel-main');

      expect(game).toBeDefined();
      expect(game.mainChannelId).toBe('channel-main');
    });

    test('retourne une partie par son village channel', () => {
      gameManager.create('channel-main');
      const game = gameManager.games.get('channel-main');
      game.villageChannelId = 'channel-village';

      const foundGame = gameManager.getGameByChannelId('channel-village');
      expect(foundGame).toBeDefined();
      expect(foundGame.mainChannelId).toBe('channel-main');
    });

    test('retourne une partie par son wolves channel', () => {
      gameManager.create('channel-main');
      const game = gameManager.games.get('channel-main');
      game.wolvesChannelId = 'channel-wolves';

      const foundGame = gameManager.getGameByChannelId('channel-wolves');
      expect(foundGame).toBeDefined();
    });

    test('retourne null si aucune partie trouvée', () => {
      const game = gameManager.getGameByChannelId('channel-invalid');

      expect(game).toBeNull();
    });
  });
});
