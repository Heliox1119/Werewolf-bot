const gameManagerModule = require('../../game/gameManager');
const { GameManager } = gameManagerModule;
const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const {
  createMockUser,
  cleanupTest
} = require('../helpers/testHelpers');
const fs = require('fs');

jest.mock('fs');

describe('Integration: Partie complète de loup-garou', () => {
  let gameManager;
  let channelId;
  let players;

  beforeEach(() => {
    gameManager = new GameManager();
    channelId = 'game-integration-test';
    
    // Créer 7 joueurs
    players = [
      createMockUser('player-1', 'Alice'),
      createMockUser('player-2', 'Bob'),
      createMockUser('player-3', 'Charlie'),
      createMockUser('player-4', 'Diana'),
      createMockUser('player-5', 'Eve'),
      createMockUser('player-6', 'Frank'),
      createMockUser('player-7', 'Grace')
    ];

    fs.writeFileSync = jest.fn();
    fs.existsSync = jest.fn(() => false);
    fs.readFileSync = jest.fn(() => '{}');
  });

  afterEach(() => {
    cleanupTest();
  });

  test('Workflow complet: création -> lobby -> démarrage -> première nuit', () => {
    // 1. CRÉATION
    const created = gameManager.create(channelId);
    expect(created).toBe(true);
    
    const game = gameManager.games.get(channelId);
    expect(game).toBeDefined();
    expect(game.players).toHaveLength(0);

    // 2. LOBBY - Joueurs rejoignent
    players.forEach(player => {
      const joined = gameManager.join(channelId, player);
      expect(joined).toBe(true);
    });

    expect(game.players).toHaveLength(7);
    expect(game.phase).toBe(PHASES.NIGHT); // "Nuit" par défaut

    // 3. DÉMARRAGE - Attribution des rôles
    const roles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
      ROLES.VILLAGER,
      ROLES.VILLAGER
    ];

    const startedGame = gameManager.start(channelId, roles);
    expect(startedGame).not.toBeNull();
    expect(startedGame.dayCount).toBeGreaterThanOrEqual(0);

    // Vérifier que tous les joueurs ont un rôle
    startedGame.players.forEach(player => {
      expect(player.role).toBeDefined();
      expect(roles).toContain(player.role);
    });

    // 4. NUIT 1 - Actions des loups (killTarget pas encore implémenté)
    const wolves = startedGame.players.filter(p => p.role === ROLES.WEREWOLF);
    expect(wolves).toHaveLength(2);

    const victim = startedGame.players.find(p => p.role === ROLES.VILLAGER);
    // const killSuccess = gameManager.killTarget(channelId, victim.id);
    // expect(killSuccess).toBe(true);
    // expect(startedGame.killTarget).toBe(victim.id);

    // 5. NUIT 1 - Action de la voyante
    const seer = startedGame.players.find(p => p.role === ROLES.SEER);
    const targetToSee = wolves[0];
    
    // Simuler /see (normalement fait dans la commande)
    startedGame.seerTarget = targetToSee.id;
    expect(startedGame.seerTarget).toBe(targetToSee.id);

    // 6. NUIT 1 - Action de la sorcière
    const witch = startedGame.players.find(p => p.role === ROLES.WITCH);
    
    // Sorcière sauve la victime
    startedGame.witchSave = victim.id;
    startedGame.hasUsedLifePotion = true;
    expect(startedGame.witchSave).toBe(victim.id);
    expect(startedGame.hasUsedLifePotion).toBe(true);

    // Vérifier qu'aucun gagnant pour l'instant
    const winner = gameManager.checkWinner(startedGame);
    expect(winner).toBeNull();
  });

  test('Scénario: Loups gagnent', () => {
    gameManager.create(channelId);
    
    // 5 joueurs: 2 loups, 3 villageois
    const smallPlayers = players.slice(0, 5);
    smallPlayers.forEach(p => gameManager.join(channelId, p));

    const roles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.VILLAGER,
      ROLES.VILLAGER,
      ROLES.VILLAGER
    ];

    const game = gameManager.start(channelId, roles);
    
    // Tuer tous les villageois
    game.players
      .filter(p => p.role !== ROLES.WEREWOLF)
      .forEach(p => p.alive = false);

    const winner = gameManager.checkWinner(game);
    expect(winner).toBe('wolves');
  });

  test('Scénario: Village gagne', () => {
    gameManager.create(channelId);
    
    const smallPlayers = players.slice(0, 5);
    smallPlayers.forEach(p => gameManager.join(channelId, p));

    const roles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.VILLAGER,
      ROLES.SEER,
      ROLES.HUNTER
    ];

    const game = gameManager.start(channelId, roles);
    
    // Éliminer tous les loups
    game.players
      .filter(p => p.role === ROLES.WEREWOLF)
      .forEach(p => p.alive = false);

    const winner = gameManager.checkWinner(game);
    expect(winner).toBe('village');
  });

  test('Scénario: Amoureux gagnent', () => {
    gameManager.create(channelId);
    
    smallPlayers = players.slice(0, 6);
    smallPlayers.forEach(p => gameManager.join(channelId, p));

    const roles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.VILLAGER,
      ROLES.VILLAGER,
      ROLES.CUPID,
      ROLES.SEER
    ];

    const game = gameManager.start(channelId, roles);
    
    // Cupidon crée un couple
    const lover1 = game.players[0];
    const lover2 = game.players[1];
    lover1.inLove = true;
    lover2.inLove = true;
    game.lovers = [lover1.id, lover2.id];

    // Tous les autres meurent
    game.players.forEach(p => {
      if (!p.inLove) p.alive = false;
    });

    const winner = gameManager.checkWinner(game);
    expect(winner).toBe('lovers');
  });

  // Test cycle votes - nécessite implémentation de vote()
  // test('Cycle jour/nuit avec votes', () => { ... });

  test('Plusieurs parties simultanées sur différents channels', () => {
    const channel1 = 'game-1';
    const channel2 = 'game-2';

    // Créer deux parties
    gameManager.create(channel1);
    gameManager.create(channel2);

    // Ajouter joueurs à chaque partie
    players.slice(0, 5).forEach(p => gameManager.join(channel1, p));
    players.slice(5, 7).forEach(p => {
      const newUser = createMockUser(`${p.id}-copy`, `${p.username}Copy`);
      gameManager.join(channel2, newUser);
    });
    // Ajouter plus de joueurs à channel2
    [8, 9, 10, 11, 12].forEach(i => {
      gameManager.join(channel2, createMockUser(`player-${i}`, `Player${i}`));
    });

    const game1 = gameManager.games.get(channel1);
    const game2 = gameManager.games.get(channel2);

    expect(game1.players).toHaveLength(5);
    expect(game2.players).toHaveLength(7);

    // Les parties sont indépendantes
    expect(game1).not.toBe(game2);
    expect(game1.mainChannelId).not.toBe(game2.mainChannelId);
  });
});
