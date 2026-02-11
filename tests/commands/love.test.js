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

const loveCommand = require('../../commands/love');

describe('Commande /love', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-love') {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.phase = PHASES.NIGHT;
    game.subPhase = PHASES.LOUPS;
    game.cupidChannelId = 'ch-cupid';
    game.villageChannelId = 'ch-village';
    game.mainChannelId = channelId;
    game.lovers = [];
    return game;
  }

  test('refuse en dehors de la catégorie', async () => {
    isInGameCategory.mockReturnValue(false);
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid' });

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Action interdite')
    }));
  });

  test('refuse depuis un mauvais channel', async () => {
    const game = setupGame();
    // Use village channel so game is found but it's not cupid channel
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-village' });

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('channel de Cupidon')
    }));
  });

  test('refuse si pas Cupidon', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'user-123', role: ROLES.VILLAGER, alive: true }));
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'user-123' });

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pas Cupidon')
    }));
  });

  test('refuse si couple déjà défini', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'cupid1', role: ROLES.CUPID, alive: true }));
    game.lovers = [['a', 'b']];
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'cupid1' });

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('déjà utilisé')
    }));
  });

  test('refuse si les deux cibles sont la même personne', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'cupid1', role: ROLES.CUPID, alive: true }));
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'cupid1' });
    const userA = { id: 'same', username: 'Same', send: jest.fn() };
    interaction.options.getUser = jest.fn()
      .mockReturnValueOnce(userA)
      .mockReturnValueOnce(userA);

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('deux personnes différentes')
    }));
  });

  test('refuse si une cible n\'est pas dans la partie', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'cupid1', role: ROLES.CUPID, alive: true }),
      createMockPlayer({ id: 'p1', alive: true })
    );
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'cupid1' });
    interaction.options.getUser = jest.fn()
      .mockReturnValueOnce({ id: 'p1', username: 'P1', send: jest.fn() })
      .mockReturnValueOnce({ id: 'outsider', username: 'Outsider', send: jest.fn() });

    await loveCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('joueurs de la partie')
    }));
  });

  test('crée le couple d\'amoureux avec succès', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'cupid1', role: ROLES.CUPID, alive: true }),
      createMockPlayer({ id: 'p1', alive: true }),
      createMockPlayer({ id: 'p2', alive: true }),
      createMockPlayer({ id: '123456789012345678', role: ROLES.WEREWOLF, alive: true })
    );
    gameManager.logAction = jest.fn();
    gameManager.announcePhase = jest.fn();

    const userA = { id: 'p1', username: 'Alice', send: jest.fn() };
    const userB = { id: 'p2', username: 'Bob', send: jest.fn() };
    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'cupid1' });
    interaction.options.getUser = jest.fn()
      .mockReturnValueOnce(userA)
      .mockReturnValueOnce(userB);

    await loveCommand.execute(interaction);

    expect(game.lovers).toHaveLength(1);
    expect(game.lovers[0]).toEqual(['p1', 'p2']);
    expect(userA.send).toHaveBeenCalled();
    expect(userB.send).toHaveBeenCalled();
  });

  test('chaîne vers les loups si des loups sont vivants', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'cupid1', role: ROLES.CUPID, alive: true }),
      createMockPlayer({ id: 'p1', alive: true }),
      createMockPlayer({ id: 'p2', alive: true }),
      createMockPlayer({ id: '123456789012345678', role: ROLES.WEREWOLF, alive: true })
    );
    gameManager.logAction = jest.fn();
    gameManager.announcePhase = jest.fn();

    const interaction = createMockInteraction({ commandName: 'love', channelId: 'ch-cupid', userId: 'cupid1' });
    interaction.options.getUser = jest.fn()
      .mockReturnValueOnce({ id: 'p1', username: 'A', send: jest.fn() })
      .mockReturnValueOnce({ id: 'p2', username: 'B', send: jest.fn() });

    await loveCommand.execute(interaction);

    expect(game.subPhase).toBe(PHASES.LOUPS);
    expect(gameManager.announcePhase).toHaveBeenCalled();
  });
});
