const gameManager = require('../../game/gameManager');
const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');
const {
  createMockInteraction,
  createMockPlayer,
  cleanupTest
} = require('../helpers/testHelpers');

jest.mock('../../utils/validators', () => ({
  isInGameCategory: jest.fn(() => true),
  getCategoryId: jest.fn(() => 'cat-123')
}));
const { isInGameCategory } = require('../../utils/validators');

jest.mock('../../utils/interaction', () => ({
  safeReply: jest.fn(async (interaction, opts) => {
    interaction._replyContent = opts;
    return {};
  })
}));
const { safeReply } = require('../../utils/interaction');

const seeCommand = require('../../commands/see');

describe('Commande /see', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-see') {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.phase = PHASES.NIGHT;
    game.subPhase = PHASES.VOYANTE;
    game.seerChannelId = 'ch-seer';
    game.villageChannelId = 'ch-village';
    game.mainChannelId = channelId;
    return game;
  }

  test('refuse en dehors de la catégorie', async () => {
    isInGameCategory.mockReturnValue(false);
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Action interdite')
    }));
  });

  test('refuse depuis un mauvais channel', async () => {
    const game = setupGame();
    // Use village channel so game is found but it's not seer channel
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-village' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('channel de la voyante')
    }));
  });

  test('refuse pendant le jour', async () => {
    const game = setupGame();
    game.phase = PHASES.DAY;
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('nuit')
    }));
  });

  test('refuse pendant la mauvaise sous-phase', async () => {
    const game = setupGame();
    game.subPhase = PHASES.LOUPS;
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('tour de la voyante')
    }));
  });

  test('refuse si pas la voyante', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'user-123', role: ROLES.VILLAGER, alive: true }));
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer', userId: 'user-123' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pas la voyante')
    }));
  });

  test('refuse si la voyante est morte', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'seer1', role: ROLES.SEER, alive: false }));
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer', userId: 'seer1' });

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('morte')
    }));
  });

  test('révèle le rôle du joueur ciblé', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'seer1', role: ROLES.SEER, alive: true }),
      createMockPlayer({ id: 'target1', role: ROLES.WEREWOLF, username: 'SuspectGuy', alive: true })
    );
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.advanceSubPhase = jest.fn();

    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer', userId: 'seer1' });
    interaction.options.getUser = jest.fn(() => ({ id: 'target1', username: 'SuspectGuy' }));

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining(ROLES.WEREWOLF)
    }));
  });

  test('refuse si le joueur ciblé n\'est pas inscrit', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'seer1', role: ROLES.SEER, alive: true }));
    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer', userId: 'seer1' });
    interaction.options.getUser = jest.fn(() => ({ id: 'unknown', username: 'Unknown' }));

    await seeCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('non trouvé')
    }));
  });

  test('avance la sous-phase après vision', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'seer1', role: ROLES.SEER, alive: true }),
      createMockPlayer({ id: 'target1', role: ROLES.VILLAGER, alive: true })
    );
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.advanceSubPhase = jest.fn(async () => {
      game.subPhase = PHASES.REVEIL;
    });
    gameManager.transitionToDay = jest.fn();

    const interaction = createMockInteraction({ commandName: 'see', channelId: 'ch-seer', userId: 'seer1' });
    interaction.options.getUser = jest.fn(() => ({ id: 'target1', username: 'Target' }));

    await seeCommand.execute(interaction);

    expect(gameManager.advanceSubPhase).toHaveBeenCalled();
    expect(gameManager.transitionToDay).toHaveBeenCalled();
  });
});
