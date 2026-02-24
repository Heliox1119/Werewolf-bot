const { User, Interaction, Guild, Channel } = require('../__mocks__/discord.js');
const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');

/**
 * Crée un utilisateur Discord de test
 */
function createMockUser(id = null, username = 'TestUser') {
  const userId = id || `user-${Date.now()}-${Math.random()}`;
  return new User(userId, username);
}

/**
 * Crée une interaction Discord de test
 */
function createMockInteraction(options = {}) {
  const {
    commandName = 'test',
    channelId = 'channel-test',
    userId = 'user-test',
    guildId = 'guild-test'
  } = options;

  const interaction = new Interaction(commandName, channelId, userId);
  interaction.guild.id = guildId;
  interaction.guildId = guildId;
  
  // Configure options if provided
  if (options.integerOptions) {
    interaction.options.getInteger = jest.fn((name) => options.integerOptions[name] || null);
  }
  if (options.userOptions) {
    interaction.options.getUser = jest.fn((name) => options.userOptions[name] || null);
  }
  
  return interaction;
}

/**
 * Crée une guilde Discord de test avec channels
 */
function createMockGuild(options = {}) {
  const guild = new Guild(options.id || 'guild-test');
  
  // Ajouter des channels si spécifiés
  if (options.channels) {
    options.channels.forEach(ch => {
      const channel = new Channel(ch.id, ch.type || 0);
      channel.name = ch.name;
      guild.channels.cache.set(ch.id, channel);
    });
  }
  
  return guild;
}

/**
 * Crée un objet game de test avec configuration custom
 */
function createMockGame(options = {}) {
  const defaults = {
    mainChannelId: 'channel-main',
    lobbyMessageId: null,
    lobbyHostId: 'user-host',
    voiceChannelId: null,
    villageChannelId: null,
    wolvesChannelId: null,
    seerChannelId: null,
    witchChannelId: null,
    cupidChannelId: null,
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    dayCount: 0,
    captainId: null,
    captainVotes: new Map(),
    captainVoters: new Map(),
    lovers: [],
    players: [],
    dead: [],
    votes: new Map(),
    voters: new Map(),
    killTarget: null,
    seerTarget: null,
    witchSave: null,
    witchKill: null,
    hasUsedLifePotion: false,
    hasUsedDeathPotion: false,
    hunterTarget: null,
    petiteFilleSpy: null,
    rules: { minPlayers: 5, maxPlayers: 10 },
    history: []
  };

  return { ...defaults, ...options };
}

/**
 * Crée un joueur de test
 */
function createMockPlayer(options = {}) {
  const id = options.id || `player-${Date.now()}-${Math.random()}`;
  return {
    id,
    username: options.username || `Player-${id.slice(-4)}`,
    role: options.role || ROLES.VILLAGER,
    alive: options.alive !== undefined ? options.alive : true,
    inLove: options.inLove || false
  };
}

/**
 * Crée un game avec plusieurs joueurs
 */
function createGameWithPlayers(count = 5, options = {}) {
  const game = createMockGame(options.gameOptions || {});
  
  const roles = options.roles || [
    ROLES.WEREWOLF,
    ROLES.WEREWOLF,
    ROLES.SEER,
    ROLES.WITCH,
    ROLES.VILLAGER
  ];

  for (let i = 0; i < count; i++) {
    game.players.push(createMockPlayer({
      id: `player-${i}`,
      username: `Player${i}`,
      role: roles[i] || ROLES.VILLAGER,
      alive: true
    }));
  }

  return game;
}

/**
 * Simule un collecteur d'interactions (boutons)
 */
function createMockCollector(timeout = 60000) {
  const EventEmitter = require('events');
  const collector = new EventEmitter();
  
  collector.stop = jest.fn((reason = 'time') => {
    setTimeout(() => {
      collector.emit('end', [], reason);
    }, 0);
  });

  // Auto-stop after timeout
  if (timeout > 0) {
    const collectorTimeout = setTimeout(() => {
      if (!collector.stopped) {
        collector.stop('time');
      }
    }, timeout);
    if (typeof collectorTimeout.unref === 'function') {
      collectorTimeout.unref();
    }
  }

  return collector;
}

/**
 * Attend qu'une promesse se résolve dans les tests
 */
function waitFor(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Vérifie qu'un objet game est valide
 */
function assertValidGame(game) {
  expect(game).toBeDefined();
  expect(game.mainChannelId).toBeDefined();
  expect(game.players).toBeInstanceOf(Array);
  expect(game.phase).toBeDefined();
  expect(game.rules).toBeDefined();
}

/**
 * Vérifie qu'un joueur est valide
 */
function assertValidPlayer(player) {
  expect(player).toBeDefined();
  expect(player.id).toBeDefined();
  expect(player.username).toBeDefined();
  expect(player.role).toBeDefined();
  expect(typeof player.alive).toBe('boolean');
}

/**
 * Nettoie les timers et mocks entre les tests
 */
function cleanupTest() {
  jest.clearAllTimers();
  jest.clearAllMocks();
  // Clear the recentCommands map to prevent isRecentDuplicate from blocking
  const gameManager = require('../../game/gameManager');
  if (gameManager.recentCommands) {
    gameManager.recentCommands.clear();
  }
}

/**
 * Mock du logger pour éviter les logs pendant les tests
 */
function mockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    success: jest.fn(),
    startTimer: jest.fn(() => ({ end: jest.fn() }))
  };
}

module.exports = {
  createMockUser,
  createMockInteraction,
  createMockGuild,
  createMockGame,
  createMockPlayer,
  createGameWithPlayers,
  createMockCollector,
  waitFor,
  assertValidGame,
  assertValidPlayer,
  cleanupTest,
  mockLogger
};
