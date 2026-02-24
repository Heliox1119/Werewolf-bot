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
const { game: gameLogger } = require('../../utils/logger');

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
    if (gameManager && typeof gameManager.destroy === 'function') {
      gameManager.destroy();
    }
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
    test('enregistre un vote valide', async () => {
      gameManager.create('ch-cap');
      const game = gameManager.games.get('ch-cap');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: true }),
        createMockPlayer({ id: 't1', alive: true })
      );

      const result = await gameManager.voteCaptain('ch-cap', 'v1', 't1');

      expect(result.ok).toBe(true);
      expect(result.allVoted).toBe(false);
      expect(result.voted).toBe(1);
      expect(result.total).toBe(2);
      expect(game.captainVotes.get('t1')).toBe(1);
      expect(game.captainVoters.get('v1')).toBe('t1');
    });

    test('refuse si pas le jour', async () => {
      gameManager.create('ch-cap2');
      const game = gameManager.games.get('ch-cap2');
      game.phase = PHASES.NIGHT;
      game.players.push(createMockPlayer({ id: 'v1' }));

      expect((await gameManager.voteCaptain('ch-cap2', 'v1', 't1')).reason).toBe('not_day');
    });

    test('refuse si mauvaise sous-phase', async () => {
      gameManager.create('ch-cap3');
      const game = gameManager.games.get('ch-cap3');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.DELIBERATION;

      expect((await gameManager.voteCaptain('ch-cap3', 'v1', 't1')).reason).toBe('wrong_phase');
    });

    test('refuse si capitaine déjà élu', async () => {
      gameManager.create('ch-cap4');
      const game = gameManager.games.get('ch-cap4');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.captainId = 'someone';

      expect((await gameManager.voteCaptain('ch-cap4', 'v1', 't1')).reason).toBe('captain_already');
    });

    test('refuse si le votant est mort', async () => {
      gameManager.create('ch-cap5');
      const game = gameManager.games.get('ch-cap5');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: false }),
        createMockPlayer({ id: 't1', alive: true })
      );

      expect((await gameManager.voteCaptain('ch-cap5', 'v1', 't1')).reason).toBe('voter_dead');
    });

    test('permet de changer de vote', async () => {
      gameManager.create('ch-cap6');
      const game = gameManager.games.get('ch-cap6');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(
        createMockPlayer({ id: 'v1', alive: true }),
        createMockPlayer({ id: 't1', alive: true }),
        createMockPlayer({ id: 't2', alive: true })
      );

      await gameManager.voteCaptain('ch-cap6', 'v1', 't1');
      const result = await gameManager.voteCaptain('ch-cap6', 'v1', 't2');

      expect(result.ok).toBe(true);
      expect(game.captainVotes.has('t1')).toBe(false);
      expect(game.captainVotes.get('t2')).toBe(1);
    });
  });

  describe('declareCaptain()', () => {
    test('déclare le capitaine avec un gagnant clair', async () => {
      gameManager.create('ch-dec');
      const game = gameManager.games.get('ch-dec');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(
        createMockPlayer({ id: 'p1', username: 'Winner', alive: true }),
        createMockPlayer({ id: 'p2', username: 'Loser', alive: true })
      );
      game.captainVotes.set('p1', 3);
      game.captainVotes.set('p2', 1);

      const result = await gameManager.declareCaptain('ch-dec');

      expect(result.ok).toBe(true);
      expect(result.winnerId).toBe('p1');
      expect(result.username).toBe('Winner');
      expect(game.captainId).toBe('p1');
    });

    test('retourne no_votes si aucun vote', async () => {
      gameManager.create('ch-dec2');
      const game = gameManager.games.get('ch-dec2');
      game.subPhase = PHASES.VOTE_CAPITAINE;

      expect((await gameManager.declareCaptain('ch-dec2')).reason).toBe('no_votes');
    });

    test('résout une égalité par tirage au sort', async () => {
      gameManager.create('ch-dec3');
      const game = gameManager.games.get('ch-dec3');
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(
        createMockPlayer({ id: 'p1', alive: true, username: 'Alice' }),
        createMockPlayer({ id: 'p2', alive: true, username: 'Bob' })
      );
      game.captainVotes.set('p1', 2);
      game.captainVotes.set('p2', 2);

      const result = await gameManager.declareCaptain('ch-dec3');
      expect(result.ok).toBe(true);
      expect(result.wasTie).toBe(true);
      expect(['p1', 'p2']).toContain(result.winnerId);
      expect(game.captainId).toBe(result.winnerId);
    });

    test('nettoie l\'état des votes après déclaration', async () => {
      gameManager.create('ch-dec4');
      const game = gameManager.games.get('ch-dec4');
      game.subPhase = PHASES.VOTE_CAPITAINE;
      game.players.push(createMockPlayer({ id: 'p1', alive: true }));
      game.captainVotes.set('p1', 1);
      game.captainVoters.set('v1', 'p1');

      await gameManager.declareCaptain('ch-dec4');

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

  describe('liveness detection', () => {
    test('freeze game artificiellement et déclenche STUCK', () => {
      gameManager.create('ch-stuck', { guildId: 'guild-stuck' });
      const game = gameManager.games.get('ch-stuck');
      game.startedAt = Date.now() - 120000;
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.DELIBERATION;
      game._lastMutationAt = Date.now() - 120000;

      const warnSpy = jest.spyOn(gameLogger, 'warn').mockImplementation(() => {});

      const stuckGames = gameManager.detectStuckGames(1000);
      expect(stuckGames.map(g => g.mainChannelId)).toContain('ch-stuck');
      expect(game.stuckStatus).toBe('STUCK');
      expect(gameManager.getStuckGamesCount(1000)).toBe(1);

      // Warning only on first transition to STUCK
      gameManager.detectStuckGames(1000);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
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

  // ==================== FSM TRANSITION TESTS ====================

  describe('FSM — Phase Transitions', () => {
    test('start() clears lobby timeout', () => {
      gameManager.create('ch-fsm-1', { guildId: 'g1' });
      const game = gameManager.games.get('ch-fsm-1');
      // Add 5 players (minimum)
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${100000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      // Lobby timeout should exist
      expect(gameManager.lobbyTimeouts.has('ch-fsm-1')).toBe(true);

      const result = gameManager.start('ch-fsm-1', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);
      expect(result).not.toBeNull();
      // Lobby timeout should be cleared after start
      expect(gameManager.lobbyTimeouts.has('ch-fsm-1')).toBe(false);
    });

    test('start() sets startedAt and assigns roles', () => {
      gameManager.create('ch-fsm-2');
      const game = gameManager.games.get('ch-fsm-2');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${200000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      const result = gameManager.start('ch-fsm-2', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);
      expect(result).not.toBeNull();
      expect(result.startedAt).toBeDefined();
      expect(result.startedAt).toBeGreaterThan(0);
      // All players should have roles
      result.players.forEach(p => {
        expect(p.role).toBeDefined();
        expect(p.role).not.toBeNull();
      });
    });

    test('start() prevents double-start', () => {
      gameManager.create('ch-fsm-3');
      const game = gameManager.games.get('ch-fsm-3');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${300000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-3', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);
      // Second start should return null
      const result2 = gameManager.start('ch-fsm-3');
      expect(result2).toBeNull();
    });

    test('nextPhase() toggles NIGHT → DAY and increments dayCount', async () => {
      gameManager.create('ch-fsm-4');
      const game = gameManager.games.get('ch-fsm-4');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${400000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-4', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);
      
      expect(game.phase).toBe(PHASES.NIGHT);
      expect(game.dayCount).toBe(0);

      const mockGuild = createMockGuild();
      await gameManager.nextPhase(mockGuild, game);
      
      expect(game.phase).toBe(PHASES.DAY);
      expect(game.dayCount).toBe(1);
    });

    test('nextPhase() toggles DAY → NIGHT', async () => {
      gameManager.create('ch-fsm-5');
      const game = gameManager.games.get('ch-fsm-5');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${500000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-5', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);

      const mockGuild = createMockGuild();
      await gameManager.nextPhase(mockGuild, game); // NIGHT → DAY
      expect(game.phase).toBe(PHASES.DAY);

      await gameManager.nextPhase(mockGuild, game); // DAY → NIGHT  
      expect(game.phase).toBe(PHASES.NIGHT);
    });

    test('nextPhase() does NOT toggle ENDED game', async () => {
      gameManager.create('ch-fsm-6');
      const game = gameManager.games.get('ch-fsm-6');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${600000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-6', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);

      // Force game to ENDED
      game.phase = PHASES.ENDED;

      const mockGuild = createMockGuild();
      const result = await gameManager.nextPhase(mockGuild, game);
      
      // Phase should still be ENDED
      expect(result).toBe(PHASES.ENDED);
      expect(game.phase).toBe(PHASES.ENDED);
    });

    test('nextPhase() resets votes and wolfVotes on new night', async () => {
      gameManager.create('ch-fsm-7');
      const game = gameManager.games.get('ch-fsm-7');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${700000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-7', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);

      const mockGuild = createMockGuild();
      // NIGHT → DAY
      await gameManager.nextPhase(mockGuild, game);
      // Add some votes
      game.votes.set('voter1', 'target1');
      game.wolfVotes = { target: 'someone' };
      
      // DAY → NIGHT
      await gameManager.nextPhase(mockGuild, game);
      
      expect(game.votes.size).toBe(0);
      expect(game.wolfVotes).toBeNull();
      expect(game.nightVictim).toBeNull();
    });

    test('nextPhase() rolls back in-memory state when DB update fails', async () => {
      gameManager.create('ch-fsm-db-fail');
      const game = gameManager.games.get('ch-fsm-db-fail');
      for (let i = 0; i < 5; i++) {
        game.players.push(createMockPlayer({ id: `${710000000000000000 + i}`, username: `P${i}`, role: null }));
      }
      gameManager.start('ch-fsm-db-fail', [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER]);

      game.votes.set('target-1', 2);
      game.voteVoters.set('voter-1', 'target-1');

      const beforePhase = game.phase;
      const beforeSubPhase = game.subPhase;
      const beforeDayCount = game.dayCount;
      const beforeVotesSize = game.votes.size;
      const beforeVoteVotersSize = game.voteVoters.size;

      const updateGameSpy = jest.spyOn(gameManager.db, 'updateGame').mockImplementation(() => {
        throw new Error('Simulated DB failure');
      });

      const mockGuild = createMockGuild();
      await expect(gameManager.nextPhase(mockGuild, game)).rejects.toThrow('Simulated DB failure');

      expect(game.phase).toBe(beforePhase);
      expect(game.subPhase).toBe(beforeSubPhase);
      expect(game.dayCount).toBe(beforeDayCount);
      expect(game.votes.size).toBe(beforeVotesSize);
      expect(game.voteVoters.size).toBe(beforeVoteVotersSize);

      updateGameSpy.mockRestore();
    });

    test('runAtomic() forbids recursive atomic calls', async () => {
      gameManager.create('ch-atomic-rec');
      gameManager._atomicContexts.set('ch-atomic-rec', { active: true, postCommit: [] });
      await expect(gameManager.runAtomic('ch-atomic-rec', () => {})).rejects.toThrow('runAtomic recursion is forbidden');
      gameManager._atomicContexts.delete('ch-atomic-rec');
    });

    test('runAtomic() rejects async mutation callback', async () => {
      gameManager.create('ch-atomic-async');
      await expect(
        gameManager.runAtomic('ch-atomic-async', async () => {
          await Promise.resolve();
        })
      ).rejects.toThrow('mutationFn must be synchronous');
    });

    test('advanceSubPhase() rolls back subPhase and does not schedule timer on DB failure', async () => {
      gameManager.create('ch-atomic-phase-fail');
      const game = gameManager.games.get('ch-atomic-phase-fail');
      game.phase = PHASES.DAY;
      game.subPhase = PHASES.REVEIL;
      game.dayCount = 1;
      game.players.push(createMockPlayer({ id: '111111111111111111', alive: true }));

      const beforeSubPhase = game.subPhase;
      const beforeCaptain = game.captainId;
      const updateGameSpy = jest.spyOn(gameManager.db, 'updateGame').mockImplementation(() => {
        throw new Error('Simulated commit crash');
      });
      const dayTimerSpy = jest.spyOn(gameManager, 'startDayTimeout');
      const captainTimerSpy = jest.spyOn(gameManager, 'startCaptainVoteTimeout');

      await expect(gameManager.advanceSubPhase(createMockGuild(), game)).rejects.toThrow('Simulated commit crash');

      expect(game.subPhase).toBe(beforeSubPhase);
      expect(game.captainId).toBe(beforeCaptain);
      expect(dayTimerSpy).not.toHaveBeenCalled();
      expect(captainTimerSpy).not.toHaveBeenCalled();

      updateGameSpy.mockRestore();
      dayTimerSpy.mockRestore();
      captainTimerSpy.mockRestore();
    });
  });

  describe('getGameSnapshot()', () => {
    test('includes all required fields', () => {
      gameManager.create('ch-snap-1');
      const game = gameManager.games.get('ch-snap-1');
      game.players.push(createMockPlayer({ id: '123456789012345678', role: ROLES.WEREWOLF }));

      const snap = gameManager.getGameSnapshot(game);
      
      expect(snap).toBeDefined();
      expect(snap.gameId).toBe('ch-snap-1');
      expect(snap.phase).toBeDefined();
      expect(snap.players).toBeInstanceOf(Array);
      expect(snap.dead).toBeInstanceOf(Array);
      expect(snap.rules).toBeDefined();
      // New fields from audit fix
      expect(snap).toHaveProperty('wolfVotes');
      expect(snap).toHaveProperty('protectedPlayerId');
      expect(snap).toHaveProperty('witchKillTarget');
      expect(snap).toHaveProperty('witchSave');
      expect(snap).toHaveProperty('thiefExtraRoles');
      expect(snap).toHaveProperty('disableVoiceMute');
    });

    test('returns null for null game', () => {
      expect(gameManager.getGameSnapshot(null)).toBeNull();
    });
  });

  describe('loadState() — reboot restore', () => {
    test('game in progress survives reboot and channels are not deleted', () => {
      // Simulate a game that was persisted in DB mid-game (started, not ended)
      const channelId = 'ch-reboot-test';
      const dbGame = {
        channel_id: channelId,
        guild_id: 'guild-123',
        lobby_message_id: 'msg-1',
        lobby_host_id: 'host-1',
        voice_channel_id: 'voice-1',
        village_channel_id: 'village-1',
        wolves_channel_id: 'wolves-1',
        seer_channel_id: 'seer-1',
        witch_channel_id: 'witch-1',
        cupid_channel_id: 'cupid-1',
        salvateur_channel_id: 'salvateur-1',
        white_wolf_channel_id: 'ww-1',
        thief_channel_id: 'thief-1',
        spectator_channel_id: 'spectator-1',
        phase: 'Nuit',
        sub_phase: 'LOUPS',
        day_count: 1,
        captain_id: null,
        night_victim_id: null,
        witch_kill_target_id: null,
        witch_save: 0,
        white_wolf_kill_target_id: null,
        protected_player_id: null,
        last_protected_player_id: null,
        village_roles_powerless: 0,
        listen_hints_given: '[]',
        thief_extra_roles: '[]',
        min_players: 5,
        max_players: 10,
        started_at: Date.now() - 60000,  // started 1 minute ago
        ended_at: null,                   // NOT ended
        disable_voice_mute: 0
      };

      // Inject into mock DB
      gameManager.db.games.set(channelId, dbGame);
      gameManager.db.players.set(channelId, [
        { id: 'p1', username: 'Alice', role: 'Loup-Garou', alive: true, inLove: false },
        { id: 'p2', username: 'Bob', role: 'Villageois', alive: true, inLove: false }
      ]);

      // Spy on setLobbyTimeout to ensure it's NOT called for started games
      const setLobbyTimeoutSpy = jest.spyOn(gameManager, 'setLobbyTimeout');

      // Simulate reboot: loadState
      gameManager.loadState();

      // Game must be restored
      expect(gameManager.games.has(channelId)).toBe(true);
      const game = gameManager.games.get(channelId);

      // Critical fields must be preserved
      expect(game.startedAt).toBeTruthy();
      expect(game.startedAt).toBe(dbGame.started_at);
      expect(game.endedAt).toBeNull();
      expect(game.phase).toBe('Nuit');
      expect(game.subPhase).toBe('LOUPS');
      expect(game.dayCount).toBe(1);

      // All channels must be present (not null, not deleted)
      expect(game.villageChannelId).toBe('village-1');
      expect(game.wolvesChannelId).toBe('wolves-1');
      expect(game.voiceChannelId).toBe('voice-1');
      expect(game.thiefChannelId).toBe('thief-1');
      expect(game.whiteWolfChannelId).toBe('ww-1');

      // Players must be restored
      expect(game.players).toHaveLength(2);
      expect(game.players[0].role).toBe('Loup-Garou');

      // Lobby timeout must NOT have been called (game is started)
      expect(setLobbyTimeoutSpy).not.toHaveBeenCalled();

      setLobbyTimeoutSpy.mockRestore();
    });

    test('restart during NIGHT keeps exactly one active timer and avoids duplicate transition', async () => {
      jest.useFakeTimers();

      const channelId = 'ch-restart-night';
      const dbGame = {
        channel_id: channelId,
        guild_id: 'guild-123',
        lobby_message_id: 'msg-1',
        lobby_host_id: 'host-1',
        voice_channel_id: null,
        village_channel_id: 'village-1',
        wolves_channel_id: 'wolves-1',
        seer_channel_id: null,
        witch_channel_id: null,
        cupid_channel_id: null,
        salvateur_channel_id: null,
        white_wolf_channel_id: null,
        thief_channel_id: null,
        spectator_channel_id: null,
        phase: PHASES.NIGHT,
        sub_phase: PHASES.LOUPS,
        day_count: 2,
        captain_id: null,
        night_victim_id: null,
        witch_kill_target_id: null,
        witch_save: 0,
        white_wolf_kill_target_id: null,
        protected_player_id: null,
        last_protected_player_id: null,
        village_roles_powerless: 0,
        listen_hints_given: '[]',
        thief_extra_roles: '[]',
        min_players: 5,
        max_players: 10,
        started_at: Date.now() - 60000,
        ended_at: null,
        disable_voice_mute: 0
      };

      gameManager.db.games.set(channelId, dbGame);
      gameManager.db.players.set(channelId, [
        { id: '111111111111111111', username: 'Wolf', role: ROLES.WEREWOLF, alive: true, inLove: false },
        { id: '222222222222222222', username: 'Villager', role: ROLES.VILLAGER, alive: true, inLove: false }
      ]);

      gameManager.loadState();
      const game = gameManager.games.get(channelId);
      const guild = createMockGuild({ id: 'guild-123' });

      const advanceSpy = jest.spyOn(gameManager, 'advanceSubPhase').mockResolvedValue(undefined);
      const transitionSpy = jest.spyOn(gameManager, 'transitionToDay').mockResolvedValue(undefined);

      // Simulate duplicate re-arm during restart path
      gameManager.startNightAfkTimeout(guild, game);
      gameManager.startNightAfkTimeout(guild, game);

      const activeTimer = gameManager.activeGameTimers.get(channelId);
      expect(activeTimer).toBeDefined();
      expect(activeTimer.type).toBe(`night-afk:${PHASES.LOUPS}`);
      expect(game._activeTimerType).toBe(`night-afk:${PHASES.LOUPS}`);

      const activeHandles = [game._nightAfkTimer, game._dayTimer, game._hunterTimer, game._captainVoteTimer]
        .filter(Boolean).length;
      expect(activeHandles).toBe(1);

      await jest.advanceTimersByTimeAsync(120_000);

      expect(advanceSpy).toHaveBeenCalledTimes(1);
      expect(transitionSpy).toHaveBeenCalledTimes(0);

      advanceSpy.mockRestore();
      transitionSpy.mockRestore();
      jest.useRealTimers();
    });
  });
});
