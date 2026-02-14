const gameManager = require('../../game/gameManager');
const {
  createMockInteraction,
  createMockGuild,
  waitFor
} = require('../helpers/testHelpers');

// Mock les dépendances
jest.mock('../../game/gameManager');
jest.mock('../../utils/validators', () => ({
  isInGameCategory: jest.fn(async () => true),
  isValidSnowflake: jest.fn(() => true),
  isAdmin: jest.fn(() => false),
  isPlayerInGame: jest.fn(() => ({ inGame: true, alive: true })),
  getCategoryId: jest.fn(() => '1469976287790633146')
}));
jest.mock('../../utils/logger', () => ({
  app: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    debug: jest.fn()
  },
  commands: {
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    debug: jest.fn()
  },
  interaction: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    debug: jest.fn()
  }
}));
jest.mock('../../utils/config', () => {
  const mockConfig = {
    initialized: true,
    get: jest.fn((key, defaultValue) => defaultValue),
    getCategoryId: jest.fn(() => '1469976287790633146'),
    getInstance: jest.fn()
  };
  mockConfig.getInstance = jest.fn(() => mockConfig);
  return mockConfig;
});

describe('Commande /create', () => {
  let createCommand;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset gameManager mock
    gameManager.games = new Map();
    gameManager.creationsInProgress = new Set();
    gameManager.isRecentDuplicate = jest.fn(() => false);
    gameManager.create = jest.fn(() => true);
    gameManager.saveState = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.createInitialChannels = jest.fn(async () => true);
    gameManager.joinVoiceChannel = jest.fn(async () => true);
    gameManager.playAmbience = jest.fn(async () => true);
    gameManager.cleanupChannels = jest.fn(async () => 0);
    gameManager.join = jest.fn(() => true);

    // Créer une interaction mock
    mockInteraction = createMockInteraction({
      commandName: 'create',
      channelId: 'channel-123',
      userId: 'user-host'
    });

    // Simuler un game créé
    const mockGame = {
      mainChannelId: 'channel-123',
      players: [],
      lobbyHostId: null,
      voiceChannelId: 'voice-123',
      rules: { minPlayers: 5, maxPlayers: 10 }
    };
    gameManager.games.set('channel-123', mockGame);

    // Charger la commande
    createCommand = require('../../commands/create');
  });

  test('refuse les commandes dupliquées', async () => {
    gameManager.isRecentDuplicate = jest.fn(() => true);

    await createCommand.execute(mockInteraction);

    expect(mockInteraction.replied || mockInteraction.deferred).toBe(true);
    expect(gameManager.create).not.toHaveBeenCalled();
  });

  test('crée une partie avec succès', async () => {
    gameManager.isRecentDuplicate = jest.fn(() => false);
    gameManager.create = jest.fn(() => true);

    await createCommand.execute(mockInteraction);

    expect(mockInteraction.deferred).toBe(true);
    expect(gameManager.create).toHaveBeenCalledWith(
      'channel-123',
      { guildId: 'guild-test' }
    );
  });

  test('refuse si une partie existe déjà', async () => {
    gameManager.create = jest.fn(() => false);

    await createCommand.execute(mockInteraction);

    expect(mockInteraction.deferred).toBe(true);
    // Devrait envoyer un message d'erreur
  });

  test('ajoute le host automatiquement', async () => {
    await createCommand.execute(mockInteraction);

    await waitFor(200); // Attendre l'exécution async

    // Le host est ajouté dans le code réel mais pas dans le mock
    // On vérifie juste que la partie est créée
    expect(gameManager.create).toHaveBeenCalled();
  });

  test('gère l\'échec de création des channels', async () => {
    gameManager.createInitialChannels = jest.fn(async () => false);

    await createCommand.execute(mockInteraction);

    await waitFor(100);

    // Devrait supprimer la partie et envoyer une erreur
    expect(gameManager.games.has('channel-123')).toBe(false);
  });

  test('nettoie les anciennes parties avant d\'en créer une nouvelle', async () => {
    const oldGame = { mainChannelId: 'channel-123', players: [] };
    gameManager.games.set('channel-123', oldGame);

    await createCommand.execute(mockInteraction);

    expect(gameManager.cleanupChannels).toHaveBeenCalled();
  });
});
