/**
 * Tests for /setup wizard (interactive) and /create guard
 */
const { ChannelType, ComponentType } = require('discord.js');
const {
  createMockInteraction,
  createMockGuild,
} = require('../helpers/testHelpers');

// ── Mocks ──
jest.mock('../../game/gameManager');
jest.mock('../../utils/logger', () => ({
  app: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    success: jest.fn(), debug: jest.fn()
  },
  commands: {
    startTimer: jest.fn(() => ({ end: jest.fn() })),
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    success: jest.fn(), debug: jest.fn()
  },
  interaction: {
    info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    success: jest.fn(), debug: jest.fn()
  }
}));
jest.mock('../../utils/theme', () => ({
  getColor: jest.fn(() => 0x00ff00),
  themeLobbyColor: jest.fn(() => 0x00ff00)
}));
jest.mock('../../utils/lobbyBuilder', () => ({
  buildLobbyMessage: jest.fn(() => ({ content: 'lobby', embeds: [], components: [], files: [] }))
}));

// Shared config mock — isSetupComplete toggleable per test
const mockConfigState = {
  isComplete: false,
  categoryId: null
};

jest.mock('../../utils/config', () => {
  const mockConfig = {
    initialized: true,
    get: jest.fn((key, defaultValue) => {
      if (key === `guild.guild-test.discord.category_id`) return mockConfigState.categoryId;
      return defaultValue;
    }),
    getCategoryId: jest.fn((guildId) => mockConfigState.categoryId),
    setCategoryId: jest.fn((id, guildId) => {
      mockConfigState.categoryId = id;
      return true;
    }),
    getDefaultGameRules: jest.fn(() => ({ minPlayers: 5, maxPlayers: 10 })),
    getWolfWinCondition: jest.fn(() => 'majority'),
    getMonitoringWebhookUrl: jest.fn(() => null),
    isSetupComplete: jest.fn((guildId) => mockConfigState.isComplete),
    getMissingSetupKeys: jest.fn(() => []),
    getSummary: jest.fn(() => ({ setupComplete: mockConfigState.isComplete })),
    getEnabledRoles: jest.fn(() => []),
    getInstance: jest.fn()
  };
  mockConfig.getInstance = jest.fn(() => mockConfig);
  return mockConfig;
});

const gameManager = require('../../game/gameManager');
const configMock = require('../../utils/config');

describe('/setup wizard — interactive', () => {
  let setupCommand;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigState.isComplete = false;
    mockConfigState.categoryId = null;

    mockInteraction = createMockInteraction({
      commandName: 'setup',
      channelId: 'channel-setup',
      userId: 'user-admin'
    });
    mockInteraction.options.getSubcommand = jest.fn(() => 'wizard');
    // Default: has ManageGuild permission
    mockInteraction.member = {
      permissions: { has: jest.fn(() => true) }
    };

    setupCommand = require('../../commands/setup');
  });

  test('refuses without ManageGuild permission', async () => {
    mockInteraction.member.permissions.has = jest.fn(() => false);

    await setupCommand.execute(mockInteraction);

    expect(mockInteraction.replied).toBe(true);
    expect(mockInteraction._replyContent.content).toContain('permission');
    expect(mockInteraction._replyContent.flags).toBe(64); // MessageFlags.Ephemeral
  });

  test('refuses if already configured', async () => {
    mockConfigState.isComplete = true;

    await setupCommand.execute(mockInteraction);

    expect(mockInteraction.replied).toBe(true);
    expect(mockInteraction._replyContent.content).toMatch(/already configured|d\u00e9j\u00e0 configur/i);
  });

  test('shows 3 buttons (auto, choose, cancel)', async () => {
    // Make awaitMessageComponent reject (timeout) so we can inspect the reply
    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      mockInteraction._replyContent = options;
      const msg = {
        awaitMessageComponent: jest.fn().mockRejectedValue(new Error('timeout')),
        edit: jest.fn()
      };
      return { resource: { message: msg } };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    expect(mockInteraction.reply).toHaveBeenCalled();
    const replyArgs = mockInteraction.reply.mock.calls[0][0];
    expect(replyArgs.embeds).toHaveLength(1);
    expect(replyArgs.components).toHaveLength(1);
    expect(replyArgs.components[0].components).toHaveLength(3);
    expect(replyArgs.flags).toBe(64); // MessageFlags.Ephemeral
  });

  test('cancel button aborts wizard', async () => {
    // Simulate cancel button press
    const cancelInteraction = {
      customId: 'setup_wizard_cancel',
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      mockInteraction._replyContent = options;
      return {
        resource: { message: {
          awaitMessageComponent: jest.fn().mockResolvedValue(cancelInteraction)
        }}
      };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    expect(cancelInteraction.deferUpdate).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editArgs = mockInteraction.editReply.mock.calls[0][0];
    expect(editArgs.components).toEqual([]);
    // Config not modified
    expect(configMock.getInstance().setCategoryId).not.toHaveBeenCalled();
  });

  test('auto setup creates category and channel', async () => {
    const autoInteraction = {
      customId: 'setup_wizard_auto',
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      mockInteraction._replyContent = options;
      return {
        resource: { message: {
          awaitMessageComponent: jest.fn().mockResolvedValue(autoInteraction)
        }}
      };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    expect(autoInteraction.deferUpdate).toHaveBeenCalled();
    // Should have created a category + a text channel
    expect(mockInteraction.guild.channels.create).toHaveBeenCalledTimes(2);
    const createCalls = mockInteraction.guild.channels.create.mock.calls;
    // First call: category creation
    expect(createCalls[0][0].type).toBe(ChannelType.GuildCategory);
    expect(createCalls[0][0].name).toBe('🐺 Werewolf');
    // Second call: text channel
    expect(createCalls[1][0].type).toBe(ChannelType.GuildText);
    // setCategoryId called
    expect(configMock.getInstance().setCategoryId).toHaveBeenCalled();
    // Success embed sent
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editArgs = mockInteraction.editReply.mock.calls[0][0];
    expect(editArgs.embeds[0].data.description).toMatch(/\/create/);
  });

  test('auto setup reuses existing Werewolf category', async () => {
    // Add existing category
    const existingCat = { id: 'cat-existing', type: ChannelType.GuildCategory, name: '🐺 Werewolf' };
    mockInteraction.guild.channels.cache.set('cat-existing', existingCat);

    const autoInteraction = {
      customId: 'setup_wizard_auto',
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      return {
        resource: { message: {
          awaitMessageComponent: jest.fn().mockResolvedValue(autoInteraction)
        }}
      };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    // Category NOT created (reused), only text channel created
    const createCalls = mockInteraction.guild.channels.create.mock.calls;
    const categoryCreated = createCalls.some(c => c[0].type === ChannelType.GuildCategory);
    expect(categoryCreated).toBe(false);
    // setCategoryId called with existing ID
    expect(configMock.getInstance().setCategoryId).toHaveBeenCalledWith('cat-existing', 'guild-test');
  });

  test('choose category shows select menu and saves selection', async () => {
    // Add categories to guild
    mockInteraction.guild.channels.cache.set('cat-1', { id: 'cat-1', type: ChannelType.GuildCategory, name: 'Gaming' });
    mockInteraction.guild.channels.cache.set('cat-2', { id: 'cat-2', type: ChannelType.GuildCategory, name: 'Text' });

    const chooseInteraction = {
      customId: 'setup_wizard_choose',
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    const selectInteraction = {
      customId: 'setup_wizard_category_select',
      values: ['cat-1'],
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    let replyMsg;
    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      mockInteraction._replyContent = options;
      replyMsg = {
        awaitMessageComponent: jest.fn()
          .mockResolvedValueOnce(chooseInteraction)
          .mockResolvedValueOnce(selectInteraction)
      };
      return { resource: { message: replyMsg } };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    // Button handler showed select menu via editReply
    expect(chooseInteraction.deferUpdate).toHaveBeenCalled();
    // editReply called: first for select menu prompt, then for success
    expect(mockInteraction.editReply).toHaveBeenCalled();
    // Category saved
    expect(configMock.getInstance().setCategoryId).toHaveBeenCalledWith('cat-1', 'guild-test');
    // Final editReply has success embed
    const lastEditCall = mockInteraction.editReply.mock.calls[mockInteraction.editReply.mock.calls.length - 1][0];
    expect(lastEditCall.embeds[0].data.description).toMatch(/Gaming/);
  });

  test('choose category with no categories shows error', async () => {
    // No categories in cache (only non-category channels)
    mockInteraction.guild.channels.cache.clear();

    const chooseInteraction = {
      customId: 'setup_wizard_choose',
      user: { id: 'user-admin' },
      deferUpdate: jest.fn()
    };

    mockInteraction.reply = jest.fn(async (options) => {
      mockInteraction.replied = true;
      return {
        resource: { message: {
          awaitMessageComponent: jest.fn().mockResolvedValue(chooseInteraction)
        }}
      };
    });
    mockInteraction.editReply = jest.fn();

    await setupCommand.execute(mockInteraction);

    expect(chooseInteraction.deferUpdate).toHaveBeenCalled();
    expect(mockInteraction.editReply).toHaveBeenCalled();
    const editArgs = mockInteraction.editReply.mock.calls[0][0];
    expect(editArgs.content).toMatch(/cat[ée]gor/i);
  });
});

describe('/create — setup guard', () => {
  let createCommand;
  let mockInteraction;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigState.isComplete = false;
    mockConfigState.categoryId = null;

    gameManager.games = new Map();
    gameManager.creationsInProgress = new Set();
    gameManager.isRecentDuplicate = jest.fn(() => false);
    gameManager.create = jest.fn((channelId) => {
      gameManager.games.set(channelId, {
        mainChannelId: channelId,
        players: [],
        lobbyHostId: null,
        voiceChannelId: 'voice-123',
        rules: { minPlayers: 5, maxPlayers: 10 },
        actionLog: []
      });
      return true;
    });
    gameManager.db = { deleteGame: jest.fn(), updateGame: jest.fn() };
    gameManager.saveState = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.createInitialChannels = jest.fn(async () => true);
    gameManager.joinVoiceChannel = jest.fn(async () => true);
    gameManager.playAmbience = jest.fn(async () => true);
    gameManager.cleanupChannels = jest.fn(async () => 0);
    gameManager.join = jest.fn(() => true);
    gameManager.runAtomic = jest.fn(async (channelId, mutator) => {
      const game = gameManager.games.get(channelId);
      if (game) mutator(game);
    });

    mockInteraction = createMockInteraction({
      commandName: 'create',
      channelId: 'channel-123',
      userId: 'user-host'
    });

    createCommand = require('../../commands/create');
  });

  test('blocks /create when setup is incomplete', async () => {
    mockConfigState.isComplete = false;

    await createCommand.execute(mockInteraction);

    // Should NOT have created a game
    expect(gameManager.create).not.toHaveBeenCalled();
    // Should NOT have created channels
    expect(gameManager.createInitialChannels).not.toHaveBeenCalled();
    // Should NOT have mutated DB
    expect(gameManager.db.deleteGame).not.toHaveBeenCalled();
    // Should have replied with error
    expect(mockInteraction.replied).toBe(true);
    const content = mockInteraction._replyContent?.content || '';
    expect(content).toMatch(/setup wizard|`\/setup wizard`/i);
  });

  test('allows /create when setup is complete', async () => {
    mockConfigState.isComplete = true;
    mockConfigState.categoryId = 'cat-valid';

    // Add a mock category channel so validation passes
    mockInteraction.guild.channels.cache.set('cat-valid', {
      id: 'cat-valid', type: 4, name: 'Werewolf'
    });

    await createCommand.execute(mockInteraction);

    expect(gameManager.create).toHaveBeenCalled();
    expect(gameManager.createInitialChannels).toHaveBeenCalled();
  });

  test('no channel created and no DB mutation when blocked', async () => {
    mockConfigState.isComplete = false;

    await createCommand.execute(mockInteraction);

    expect(gameManager.create).not.toHaveBeenCalled();
    expect(gameManager.createInitialChannels).not.toHaveBeenCalled();
    expect(gameManager.join).not.toHaveBeenCalled();
    expect(gameManager.saveState).not.toHaveBeenCalled();
  });

  test('after wizard setup, /create works', async () => {
    // Simulate: wizard was just completed
    mockConfigState.isComplete = true;
    mockConfigState.categoryId = 'cat-new';

    mockInteraction.guild.channels.cache.set('cat-new', {
      id: 'cat-new', type: 4, name: '🐺 Werewolf'
    });

    await createCommand.execute(mockInteraction);

    expect(gameManager.create).toHaveBeenCalledWith(
      'channel-123',
      { guildId: 'guild-test' }
    );
    expect(gameManager.createInitialChannels).toHaveBeenCalledWith(
      expect.anything(),
      'channel-123',
      expect.anything(),
      'cat-new'
    );
  });
});
