const gameManager = require('../../game/gameManager');
const PHASES = require('../../game/phases');
const ROLES = require('../../game/roles');
const {
  createMockInteraction,
  createMockPlayer,
  cleanupTest
} = require('../helpers/testHelpers');

// Mock validators
jest.mock('../../utils/validators', () => ({
  isInGameCategory: jest.fn(() => true),
  getCategoryId: jest.fn(() => 'cat-123')
}));
const { isInGameCategory } = require('../../utils/validators');

// Mock interaction
jest.mock('../../utils/interaction', () => ({
  safeReply: jest.fn(async (interaction, opts) => {
    interaction._replyContent = opts;
    return {};
  })
}));
const { safeReply } = require('../../utils/interaction');

const voteCommand = require('../../commands/vote');

describe('Commande /vote', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    // Reset singleton state
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    gameManager.db.votes.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-vote', options = {}) {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.phase = options.phase || PHASES.DAY;
    game.villageChannelId = options.villageChannelId || 'ch-village';
    game.mainChannelId = channelId;
    game.dayCount = options.dayCount || 1;
    game.voteVoters = new Map();
    game.votes = new Map();
    return game;
  }

  test('refuse en dehors de la catégorie jeu', async () => {
    isInGameCategory.mockReturnValue(false);
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Action interdite')
    }));
  });

  test('refuse quand aucune partie', async () => {
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-none' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('Aucune partie')
    }));
  });

  test('refuse depuis un mauvais channel', async () => {
    const game = setupGame('ch-vote');
    // Use wolves channel so game is found but it's not main/village
    game.wolvesChannelId = 'ch-wolves';
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-wolves' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('channel principal ou village')
    }));
  });

  test('refuse pendant la nuit', async () => {
    const game = setupGame('ch-vote', { phase: PHASES.NIGHT });
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pendant le jour')
    }));
  });

  test('refuse un joueur non-inscrit', async () => {
    const game = setupGame('ch-vote');
    game.players.push(createMockPlayer({ id: 'p1', alive: true }));
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: 'outsider' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('pas dans cette partie')
    }));
  });

  test('refuse un joueur mort', async () => {
    const game = setupGame('ch-vote');
    game.players.push(createMockPlayer({ id: 'dead-guy', alive: false }));
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: 'dead-guy' });

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('mort')
    }));
  });

  test('refuse de voter pour un joueur non-inscrit', async () => {
    const game = setupGame('ch-vote');
    game.players.push(createMockPlayer({ id: 'voter1', alive: true }));
    const targetUser = { id: 'unknown', username: 'Unknown' };
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: 'voter1' });
    interaction.options.getUser = jest.fn(() => targetUser);

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('non trouvé')
    }));
  });

  test('refuse de voter pour un joueur mort', async () => {
    const game = setupGame('ch-vote');
    game.players.push(
      createMockPlayer({ id: 'voter1', alive: true }),
      createMockPlayer({ id: 'dead-target', alive: false })
    );
    const targetUser = { id: 'dead-target', username: 'Dead' };
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: 'voter1' });
    interaction.options.getUser = jest.fn(() => targetUser);

    await voteCommand.execute(interaction);

    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('déjà mort')
    }));
  });

  test('enregistre un vote valide', async () => {
    const game = setupGame('ch-vote');
    game.players.push(
      createMockPlayer({ id: '111111111111111111', alive: true }),
      createMockPlayer({ id: '222222222222222222', username: 'Target', alive: true })
    );
    const targetUser = { id: '222222222222222222', username: 'Target' };
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: '111111111111111111' });
    interaction.options.getUser = jest.fn(() => targetUser);

    await voteCommand.execute(interaction);

    expect(game.votes.get('222222222222222222')).toBe(1);
    expect(game.voteVoters.get('111111111111111111')).toBe('222222222222222222');
    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('voté pour')
    }));
  });

  test('le vote du capitaine compte double', async () => {
    const game = setupGame('ch-vote');
    game.captainId = '111111111111111111';
    game.players.push(
      createMockPlayer({ id: '111111111111111111', alive: true }),
      createMockPlayer({ id: '222222222222222222', username: 'Target', alive: true })
    );
    const targetUser = { id: '222222222222222222', username: 'Target' };
    const interaction = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: '111111111111111111' });
    interaction.options.getUser = jest.fn(() => targetUser);

    await voteCommand.execute(interaction);

    expect(game.votes.get('222222222222222222')).toBe(2);
    expect(safeReply).toHaveBeenCalledWith(interaction, expect.objectContaining({
      content: expect.stringContaining('capitaine')
    }));
  });

  test('permet de changer de vote', async () => {
    const game = setupGame('ch-vote');
    game.players.push(
      createMockPlayer({ id: '111111111111111111', alive: true }),
      createMockPlayer({ id: '222222222222222222', username: 'Target1', alive: true }),
      createMockPlayer({ id: '333333333333333333', username: 'Target2', alive: true })
    );

    // Premier vote
    const i1 = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: '111111111111111111' });
    i1.options.getUser = jest.fn(() => ({ id: '222222222222222222', username: 'Target1' }));
    await voteCommand.execute(i1);

    // Deuxième vote (changement)
    const i2 = createMockInteraction({ commandName: 'vote', channelId: 'ch-vote', userId: '111111111111111111' });
    i2.options.getUser = jest.fn(() => ({ id: '333333333333333333', username: 'Target2' }));
    await voteCommand.execute(i2);

    expect(game.votes.has('222222222222222222')).toBe(false);
    expect(game.votes.get('333333333333333333')).toBe(1);
  });
});
