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

const potionCommand = require('../../commands/potion');

describe('Commande /potion', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-pot') {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.phase = PHASES.NIGHT;
    game.subPhase = PHASES.SORCIERE;
    game.witchChannelId = 'ch-witch';
    game.villageChannelId = 'ch-village';
    game.mainChannelId = channelId;
    game.nightVictim = 'victim1';
    game.witchPotions = { life: true, death: true };
    return game;
  }

  test('refuse en dehors de la catégorie', async () => {
    isInGameCategory.mockReturnValue(false);
    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch' });

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Action interdite')
    }));
  });

  test('refuse depuis un mauvais channel', async () => {
    const game = setupGame();
    // Use village channel so game is found but it's not witch channel
    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-village' });

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('channel de la sorcière')
    }));
  });

  test('refuse pendant le jour', async () => {
    const game = setupGame();
    game.phase = PHASES.DAY;
    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch' });

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('nuit')
    }));
  });

  test('refuse pendant la mauvaise sous-phase', async () => {
    const game = setupGame();
    game.subPhase = PHASES.LOUPS;
    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch' });

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('tour de la sorcière')
    }));
  });

  test('refuse si pas la sorcière', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'user-123', role: ROLES.VILLAGER, alive: true }));
    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'user-123' });

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pas la sorcière')
    }));
  });

  test('utilise la potion de vie avec succès', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }));
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.transitionToDay = jest.fn();
    gameManager.announcePhase = jest.fn();
    gameManager.startNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'life');

    await potionCommand.execute(interaction);

    expect(game.witchPotions.life).toBe(false);
    expect(game.witchSave).toBe(true);
    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Potion de vie')
    }));
  });

  test('refuse la potion de vie si déjà utilisée', async () => {
    const game = setupGame();
    game.witchPotions.life = false;
    game.players.push(createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }));
    gameManager.clearNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'life');

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('plus de potion de vie')
    }));
  });

  test('utilise la potion de mort avec succès', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }),
      createMockPlayer({ id: 'target1', role: ROLES.VILLAGER, username: 'TargetPlayer', alive: true })
    );
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.transitionToDay = jest.fn();
    gameManager.announcePhase = jest.fn();
    gameManager.startNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'death');
    interaction.options.getUser = jest.fn(() => ({ id: 'target1', username: 'TargetPlayer' }));

    await potionCommand.execute(interaction);

    expect(game.witchPotions.death).toBe(false);
    expect(game.witchKillTarget).toBe('target1');
    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('empoisonné')
    }));
  });

  test('refuse la potion de mort sans cible', async () => {
    const game = setupGame();
    game.players.push(createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }));
    gameManager.clearNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'death');
    interaction.options.getUser = jest.fn(() => null);

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('spécifier une cible')
    }));
  });

  test('refuse la potion de mort si déjà utilisée', async () => {
    const game = setupGame();
    game.witchPotions.death = false;
    game.players.push(createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }));
    gameManager.clearNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'death');

    await potionCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('plus de potion de mort')
    }));
  });

  test('chaîne vers la voyante si elle est vivante', async () => {
    const game = setupGame();
    game.players.push(
      createMockPlayer({ id: 'witch1', role: ROLES.WITCH, alive: true }),
      createMockPlayer({ id: '123456789012345678', role: ROLES.SEER, alive: true })
    );
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.announcePhase = jest.fn();
    gameManager.startNightAfkTimeout = jest.fn();

    const interaction = createMockInteraction({ commandName: 'potion', channelId: 'ch-witch', userId: 'witch1' });
    interaction.options.getString = jest.fn(() => 'life');

    await potionCommand.execute(interaction);

    expect(game.subPhase).toBe(PHASES.VOYANTE);
    expect(gameManager.announcePhase).toHaveBeenCalled();
  });
});
