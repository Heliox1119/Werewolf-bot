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

  describe('kill()', () => {
    test('tue un joueur vivant', () => {
      gameManager.create('ch-kill');
      const game = gameManager.games.get('ch-kill');
      game.players.push(
        createMockPlayer({ id: 'p1', role: ROLES.VILLAGER, alive: true }),
        createMockPlayer({ id: 'p2', role: ROLES.WEREWOLF, alive: true })
      );

      gameManager.kill('ch-kill', 'p1');

      const p1 = game.players.find(p => p.id === 'p1');
      expect(p1.alive).toBe(false);
      expect(game.dead).toContain(p1);
    });

    test('ne fait rien si le channel est invalide', () => {
      expect(() => gameManager.kill('invalid', 'p1')).not.toThrow();
    });

    test('ne fait rien si le joueur est déjà mort', () => {
      gameManager.create('ch-kill2');
      const game = gameManager.games.get('ch-kill2');
      game.players.push(
        createMockPlayer({ id: 'p1', alive: false })
      );
      game.dead.push(game.players[0]);

      gameManager.kill('ch-kill2', 'p1');
      expect(game.dead).toHaveLength(1); // pas de double ajout
    });

    test('tue le partenaire amoureux quand un amoureux meurt', () => {
      gameManager.create('ch-love');
      const game = gameManager.games.get('ch-love');
      game.players.push(
        createMockPlayer({ id: 'p1', alive: true }),
        createMockPlayer({ id: 'p2', alive: true }),
        createMockPlayer({ id: 'p3', alive: true })
      );
      game.lovers = [['p1', 'p2']];

      gameManager.kill('ch-love', 'p1');

      expect(game.players.find(p => p.id === 'p1').alive).toBe(false);
      expect(game.players.find(p => p.id === 'p2').alive).toBe(false);
      expect(game.players.find(p => p.id === 'p3').alive).toBe(true);
    });
  });

  describe('getAlive()', () => {
    test('retourne les joueurs vivants', () => {
      gameManager.create('ch-alive');
      const game = gameManager.games.get('ch-alive');
      game.players.push(
        createMockPlayer({ id: 'p1', alive: true }),
        createMockPlayer({ id: 'p2', alive: false }),
        createMockPlayer({ id: 'p3', alive: true })
      );

      const alive = gameManager.getAlive('ch-alive');
      expect(alive).toHaveLength(2);
      expect(alive.map(p => p.id)).toEqual(['p1', 'p3']);
    });

    test('retourne vide si pas de partie', () => {
      expect(gameManager.getAlive('invalid')).toEqual([]);
    });
  });

  describe('nextPhase()', () => {
    let guild;
    beforeEach(() => {
      guild = createMockGuild();
    });

    test('passe de NIGHT à DAY', async () => {
      gameManager.create('ch-phase');
      const game = gameManager.games.get('ch-phase');
      game.phase = PHASES.NIGHT;
      game.dayCount = 0;

      const result = await gameManager.nextPhase(guild, game);

      expect(result).toBe(PHASES.DAY);
      expect(game.phase).toBe(PHASES.DAY);
    });

    test('passe de DAY à NIGHT', async () => {
      gameManager.create('ch-phase2');
      const game = gameManager.games.get('ch-phase2');
      game.phase = PHASES.DAY;

      const result = await gameManager.nextPhase(guild, game);

      expect(result).toBe(PHASES.NIGHT);
      expect(game.phase).toBe(PHASES.NIGHT);
    });

    test('incrémente dayCount au passage au jour', async () => {
      gameManager.create('ch-day');
      const game = gameManager.games.get('ch-day');
      game.phase = PHASES.NIGHT;
      game.dayCount = 0;

      await gameManager.nextPhase(guild, game);
      expect(game.dayCount).toBe(1);
    });

    test('réinitialise les votes au changement de phase', async () => {
      gameManager.create('ch-votes');
      const game = gameManager.games.get('ch-votes');
      game.phase = PHASES.NIGHT;
      game.votes.set('p1', 3);
      game.voteVoters = new Map([['v1', 'p1']]);
      game._voteIncrements = new Map([['v1', 2]]);

      await gameManager.nextPhase(guild, game);

      expect(game.votes.size).toBe(0);
      expect(game.voteVoters.size).toBe(0);
      expect(game._voteIncrements.size).toBe(0);
    });

    test('met subPhase à LOUPS quand nuit commence', async () => {
      gameManager.create('ch-sub');
      const game = gameManager.games.get('ch-sub');
      game.phase = PHASES.DAY;

      await gameManager.nextPhase(guild, game);
      expect(game.subPhase).toBe(PHASES.LOUPS);
      expect(game.nightVictim).toBeNull();
    });

    test('met subPhase à REVEIL quand jour commence', async () => {
      gameManager.create('ch-sub2');
      const game = gameManager.games.get('ch-sub2');
      game.phase = PHASES.NIGHT;

      await gameManager.nextPhase(guild, game);
      expect(game.subPhase).toBe(PHASES.REVEIL);
    });
  });

  describe('voteCaptain()', () => {
    test('enregistre un vote valide', () => {
      gameManager.create('ch-cap');
      const game = gameManager.games.get('ch-cap');
      game.phase = PHASES.DAY;
      game.dayCount = 1;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: true }),
        createMockPlayer({ id: 't1', alive: true })
      );

      const result = gameManager.voteCaptain('ch-cap', 'v1', 't1');

      expect(result).toEqual({ ok: true });
      expect(game.captainVotes.get('t1')).toBe(1);
      expect(game.captainVoters.get('v1')).toBe('t1');
    });

    test('refuse si pas le jour', () => {
      gameManager.create('ch-cap2');
      const game = gameManager.games.get('ch-cap2');
      game.phase = PHASES.NIGHT;
      game.players.push(createMockPlayer({ id: 'v1' }));

      expect(gameManager.voteCaptain('ch-cap2', 'v1', 't1').reason).toBe('not_day');
    });

    test('refuse si pas le premier jour', () => {
      gameManager.create('ch-cap3');
      const game = gameManager.games.get('ch-cap3');
      game.phase = PHASES.DAY;
      game.dayCount = 2;

      expect(gameManager.voteCaptain('ch-cap3', 'v1', 't1').reason).toBe('not_first_day');
    });

    test('refuse si capitaine déjà élu', () => {
      gameManager.create('ch-cap4');
      const game = gameManager.games.get('ch-cap4');
      game.phase = PHASES.DAY;
      game.dayCount = 1;
      game.captainId = 'someone';

      expect(gameManager.voteCaptain('ch-cap4', 'v1', 't1').reason).toBe('captain_already');
    });

    test('refuse si le votant est mort', () => {
      gameManager.create('ch-cap5');
      const game = gameManager.games.get('ch-cap5');
      game.phase = PHASES.DAY;
      game.dayCount = 1;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: false }),
        createMockPlayer({ id: 't1', alive: true })
      );

      expect(gameManager.voteCaptain('ch-cap5', 'v1', 't1').reason).toBe('voter_dead');
    });

    test('permet de changer de vote', () => {
      gameManager.create('ch-cap6');
      const game = gameManager.games.get('ch-cap6');
      game.phase = PHASES.DAY;
      game.dayCount = 1;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: true }),
        createMockPlayer({ id: 't1', alive: true }),
        createMockPlayer({ id: 't2', alive: true })
      );

      gameManager.voteCaptain('ch-cap6', 'v1', 't1');
      gameManager.voteCaptain('ch-cap6', 'v1', 't2');

      expect(game.captainVotes.has('t1')).toBe(false);
      expect(game.captainVotes.get('t2')).toBe(1);
    });
  });

  describe('declareCaptain()', () => {
    test('déclare le capitaine avec un gagnant clair', () => {
      gameManager.create('ch-dec');
      const game = gameManager.games.get('ch-dec');
      game.phase = PHASES.DAY;
      game.dayCount = 1;
      game.players.push(
        createMockPlayer({ id: 'p1', username: 'Winner', alive: true }),
        createMockPlayer({ id: 'p2', username: 'Loser', alive: true })
      );
      game.captainVotes.set('p1', 3);
      game.captainVotes.set('p2', 1);

      const result = gameManager.declareCaptain('ch-dec');

      expect(result.ok).toBe(true);
      expect(result.winnerId).toBe('p1');
      expect(result.username).toBe('Winner');
      expect(game.captainId).toBe('p1');
    });

    test('retourne no_votes si aucun vote', () => {
      gameManager.create('ch-dec2');
      const game = gameManager.games.get('ch-dec2');
      game.dayCount = 1;

      expect(gameManager.declareCaptain('ch-dec2').reason).toBe('no_votes');
    });

    test('retourne tie en cas d\'égalité', () => {
      gameManager.create('ch-dec3');
      const game = gameManager.games.get('ch-dec3');
      game.dayCount = 1;
      game.players.push(
        createMockPlayer({ id: 'p1', alive: true }),
        createMockPlayer({ id: 'p2', alive: true })
      );
      game.captainVotes.set('p1', 2);
      game.captainVotes.set('p2', 2);

      const result = gameManager.declareCaptain('ch-dec3');
      expect(result.ok).toBe(false);
      expect(result.reason).toBe('tie');
      expect(result.tied).toContain('p1');
      expect(result.tied).toContain('p2');
    });

    test('nettoie l\'état des votes après déclaration', () => {
      gameManager.create('ch-dec4');
      const game = gameManager.games.get('ch-dec4');
      game.dayCount = 1;
      game.players.push(createMockPlayer({ id: 'p1', alive: true }));
      game.captainVotes.set('p1', 1);
      game.captainVoters.set('v1', 'p1');

      gameManager.declareCaptain('ch-dec4');

      expect(game.captainVotes.size).toBe(0);
      expect(game.captainVoters.size).toBe(0);
    });
  });

  describe('isRealPlayerId()', () => {
    test('retourne true pour un ID numérique', () => {
      expect(gameManager.isRealPlayerId('123456789012345678')).toBe(true);
    });

    test('retourne false pour un ID non-numérique', () => {
      expect(gameManager.isRealPlayerId('player-fake')).toBe(false);
    });

    test('retourne false pour un non-string', () => {
      expect(gameManager.isRealPlayerId(12345)).toBe(false);
      expect(gameManager.isRealPlayerId(null)).toBe(false);
    });
  });

  describe('hasAliveRealRole()', () => {
    test('retourne true si un joueur vivant avec le rôle existe', () => {
      gameManager.create('ch-role');
      const game = gameManager.games.get('ch-role');
      game.players.push(
        createMockPlayer({ id: '123456789012345678', role: ROLES.WITCH, alive: true })
      );

      expect(gameManager.hasAliveRealRole(game, ROLES.WITCH)).toBe(true);
    });

    test('retourne false si le joueur avec le rôle est mort', () => {
      gameManager.create('ch-role2');
      const game = gameManager.games.get('ch-role2');
      game.players.push(
        createMockPlayer({ id: '123456789012345678', role: ROLES.WITCH, alive: false })
      );

      expect(gameManager.hasAliveRealRole(game, ROLES.WITCH)).toBe(false);
    });

    test('retourne false si aucun joueur avec ce rôle', () => {
      gameManager.create('ch-role3');
      const game = gameManager.games.get('ch-role3');
      game.players.push(
        createMockPlayer({ id: '123456789012345678', role: ROLES.VILLAGER, alive: true })
      );

      expect(gameManager.hasAliveRealRole(game, ROLES.SEER)).toBe(false);
    });
  });

  describe('getAllGames()', () => {
    test('retourne toutes les parties', () => {
      gameManager.create('ch-1');
      gameManager.create('ch-2');

      const all = gameManager.getAllGames();
      expect(all).toHaveLength(2);
    });

    test('retourne un tableau vide si aucune partie', () => {
      expect(gameManager.getAllGames()).toHaveLength(0);
    });
  });

  describe('logAction()', () => {
    test('ajoute une action au log de la partie', () => {
      gameManager.create('ch-log');
      const game = gameManager.games.get('ch-log');

      gameManager.logAction(game, 'Test action');

      expect(game.actionLog).toBeDefined();
      expect(game.actionLog.length).toBeGreaterThan(0);
      const lastEntry = game.actionLog[game.actionLog.length - 1];
      const text = typeof lastEntry === 'string' ? lastEntry : lastEntry.text;
      expect(text).toContain('Test action');
    });
  });

  describe('checkWinner() — cas draw', () => {
    test('retourne draw quand tous les joueurs sont morts', () => {
      gameManager.create('ch-draw');
      const game = gameManager.games.get('ch-draw');
      game.players.push(
        createMockPlayer({ id: '123456789012345678', role: ROLES.WEREWOLF, alive: false }),
        createMockPlayer({ id: '223456789012345678', role: ROLES.VILLAGER, alive: false })
      );

      const result = gameManager.checkWinner(game);
      expect(result).toBe('draw');
    });
  });
});
