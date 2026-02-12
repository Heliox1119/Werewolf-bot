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

const killCommand = require('../../commands/kill');

describe('Commande /kill', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-kill') {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.phase = PHASES.NIGHT;
    game.subPhase = PHASES.LOUPS;
    game.wolvesChannelId = 'ch-wolves';
    game.villageChannelId = 'ch-village';
    game.mainChannelId = channelId;
    return game;
  }

  test('refuse en dehors de la catégorie jeu', async () => {
    isInGameCategory.mockReturnValue(false);
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Action interdite')
    }));
  });

  test('refuse quand aucune partie', async () => {
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-none' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Aucune partie')
    }));
  });

  test('refuse depuis un mauvais channel', async () => {
    const game = setupGame('ch-kill');
    // Use the village channel so the game is found but it's not wolves channel
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-village' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('channel des loups')
    }));
  });

  test('refuse pendant le jour', async () => {
    const game = setupGame('ch-kill');
    game.phase = PHASES.DAY;
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('nuit')
    }));
  });

  test('refuse pendant la mauvaise sous-phase', async () => {
    const game = setupGame('ch-kill');
    game.subPhase = PHASES.SORCIERE;
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('tour des loups')
    }));
  });

  test('refuse si le joueur n\'est pas un loup', async () => {
    const game = setupGame('ch-kill');
    game.players.push(createMockPlayer({ id: 'user-123', role: ROLES.VILLAGER, alive: true }));
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'user-123' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pas un loup')
    }));
  });

  test('refuse si le loup est mort', async () => {
    const game = setupGame('ch-kill');
    game.players.push(createMockPlayer({ id: 'user-123', role: ROLES.WEREWOLF, alive: false }));
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'user-123' });

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('mort')
    }));
  });

  test('refuse de cibler un joueur non-inscrit', async () => {
    const game = setupGame('ch-kill');
    game.players.push(createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF, alive: true }));
    const targetUser = { id: 'unknown', username: 'Nobody' };
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'wolf1' });
    interaction.options.getUser = jest.fn(() => targetUser);

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('non trouvé')
    }));
  });

  test('refuse de cibler un joueur mort', async () => {
    const game = setupGame('ch-kill');
    game.players.push(
      createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF, alive: true }),
      createMockPlayer({ id: 'dead1', role: ROLES.VILLAGER, alive: false })
    );
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'wolf1' });
    interaction.options.getUser = jest.fn(() => ({ id: 'dead1', username: 'Dead' }));

    await killCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('déjà mort')
    }));
  });

  test('définit nightVictim sur un kill valide', async () => {
    const game = setupGame('ch-kill');
    game.players.push(
      createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF, alive: true }),
      createMockPlayer({ id: '123456789012345678', role: ROLES.VILLAGER, alive: true })
    );
    // No witch, no seer alive → will call transitionToDay
    gameManager.transitionToDay = jest.fn();
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    // isRealPlayerId returns false for 'wolf1' (not numeric) → single non-real wolf = immediate consensus via plurality
    // Mock guild.channels.fetch for wolf channel message
    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'wolf1' });
    interaction.options.getUser = jest.fn(() => ({ id: '123456789012345678', username: 'Victim' }));

    await killCommand.execute(interaction);

    expect(game.nightVictim).toBe('123456789012345678');
    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Victim')
    }));
  });

  test('chaîne vers la sorcière si elle est vivante', async () => {
    const game = setupGame('ch-kill');
    game.players.push(
      createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF, alive: true }),
      createMockPlayer({ id: '123456789012345678', role: ROLES.VILLAGER, alive: true }),
      createMockPlayer({ id: '223456789012345678', role: ROLES.WITCH, alive: true })
    );
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.announcePhase = jest.fn();
    gameManager.startNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'kill', channelId: 'ch-wolves', userId: 'wolf1' });
    interaction.options.getUser = jest.fn(() => ({ id: '123456789012345678', username: 'Victim' }));

    await killCommand.execute(interaction);

    expect(game.subPhase).toBe(PHASES.SORCIERE);
    expect(gameManager.announcePhase).toHaveBeenCalled();
  });
});
