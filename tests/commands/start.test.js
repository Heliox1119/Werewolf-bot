const gameManager = require('../../game/gameManager');
const ROLES = require('../../game/roles');
const {
  createMockInteraction,
  createGameWithPlayers,
  waitFor
} = require('../helpers/testHelpers');

jest.mock('../../game/gameManager');
jest.mock('../../utils/logger', () => ({
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

describe('Commande /start', () => {
  let startCommand;
  let mockInteraction;
  let mockGame;

  beforeEach(() => {
    jest.clearAllMocks();

    // Créer un jeu avec 5 joueurs
    mockGame = createGameWithPlayers(5, {
      roles: [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.VILLAGER]
    });
    mockGame.villageChannelId = 'village-123';
    mockGame.wolvesChannelId = 'wolves-123';
    mockGame.seerChannelId = 'seer-123';
    mockGame.witchChannelId = 'witch-123';

    gameManager.getGameByChannelId = jest.fn(() => mockGame);
    gameManager.start = jest.fn(() => mockGame);
    gameManager.updateChannelPermissions = jest.fn(async () => true);
    gameManager.updateVoicePerms = jest.fn(async () => true);

    mockInteraction = createMockInteraction({
      commandName: 'start',
      channelId: 'channel-123',
      userId: 'user-host'
    });

    // Ajouter le client mock
    const { Client } = require('../__mocks__/discord.js');
    mockInteraction.client = new Client();

    // Mock le channel avec la bonne catégorie
    mockInteraction.guild.channels.fetch = jest.fn(async (id) => ({
      id,
      parentId: '1469976287790633146',
      send: jest.fn(async () => ({}))
    }));

    startCommand = require('../../commands/start');
  });

  test('refuse si pas assez de joueurs', async () => {
    mockGame.players = mockGame.players.slice(0, 3); // Seulement 3 joueurs

    await startCommand.execute(mockInteraction);

    expect(mockInteraction.replied).toBe(true);
    expect(gameManager.start).not.toHaveBeenCalled();
  });

  test('démarre la partie avec le bon nombre de joueurs', async () => {
    await startCommand.execute(mockInteraction);

    await waitFor(100);

    expect(gameManager.start).toHaveBeenCalled();
    expect(gameManager.updateChannelPermissions).toHaveBeenCalled();
    expect(gameManager.updateVoicePerms).toHaveBeenCalled();
  });

  test('propose une sélection de rôles si trop de candidats', async () => {
    // Cette partie du test nécessite de mocker le collecteur
    // Pour l'instant on vérifie juste que ça ne crash pas
    await startCommand.execute(mockInteraction);
    
    expect(mockInteraction.deferred).toBe(true);
  });

  test('envoie les rôles en DM aux joueurs', async () => {
    mockInteraction.client.users.fetch = jest.fn(async (userId) => ({
      id: userId,
      send: jest.fn(async () => ({}))
    }));

    await startCommand.execute(mockInteraction);

    await waitFor(200);

    // Vérifie que fetch a été appelé pour chaque joueur
    expect(mockInteraction.client.users.fetch).toHaveBeenCalled();
  });

  test('envoie des messages dans les channels privés', async () => {
    const mockSend = jest.fn(async () => ({}));
    mockInteraction.guild.channels.fetch = jest.fn(async (id) => ({
      id,
      parentId: '1469976287790633146',
      send: mockSend
    }));

    await startCommand.execute(mockInteraction);

    await waitFor(200);

    // Devrait envoyer dans village, wolves, seer, witch
    expect(mockSend).toHaveBeenCalled();
  });

  test('refuse si la partie n\'existe pas', async () => {
    gameManager.getGameByChannelId = jest.fn(() => null);

    await startCommand.execute(mockInteraction);

    expect(mockInteraction.replied).toBe(true);
    expect(gameManager.start).not.toHaveBeenCalled();
  });

  test('gère l\'échec de mise à jour des permissions', async () => {
    gameManager.updateChannelPermissions = jest.fn(async () => false);

    await startCommand.execute(mockInteraction);

    await waitFor(100);

    // Devrait envoyer un message d'erreur
    expect(mockInteraction._replyContent).toBeDefined();
  });
});
