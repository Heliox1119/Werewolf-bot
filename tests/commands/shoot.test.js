const gameManager = require('../../game/gameManager');
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

const shootCommand = require('../../commands/shoot');

describe('Commande /shoot', () => {
  beforeEach(() => {
    isInGameCategory.mockReturnValue(true);
    safeReply.mockClear();
    gameManager.games.clear();
    gameManager.db.games.clear();
    gameManager.db.players.clear();
    cleanupTest();
  });

  function setupGame(channelId = 'ch-shoot') {
    gameManager.create(channelId);
    const game = gameManager.games.get(channelId);
    game.mainChannelId = channelId;
    game.villageChannelId = 'ch-village';
    game.dayCount = 1;
    game._hunterMustShoot = 'hunter1';
    return game;
  }

  test('deux /shoot concurrents: un seul tir effectif', async () => {
    const game = setupGame('ch-shoot-concurrent');
    game.players.push(
      createMockPlayer({ id: 'hunter1', role: ROLES.HUNTER, alive: false, username: 'Hunter' }),
      createMockPlayer({ id: 'target1', role: ROLES.VILLAGER, alive: true, username: 'Target' })
    );

    const duplicateSpy = jest.spyOn(gameManager, 'isRecentDuplicate').mockReturnValue(false);
    const claimSpy = jest.spyOn(gameManager.db, 'markHunterShotIfFirst');
    const killSpy = jest.spyOn(gameManager, 'kill').mockImplementation(() => []);
    const nightActionSpy = jest.spyOn(gameManager.db, 'addNightActionOnce');

    const i1 = createMockInteraction({ commandName: 'shoot', channelId: 'ch-shoot-concurrent', userId: 'hunter1' });
    i1.options.getUser = jest.fn(() => ({ id: 'target1', username: 'Target' }));

    const i2 = createMockInteraction({ commandName: 'shoot', channelId: 'ch-shoot-concurrent', userId: 'hunter1' });
    i2.options.getUser = jest.fn(() => ({ id: 'target1', username: 'Target' }));

    await Promise.all([shootCommand.execute(i1), shootCommand.execute(i2)]);

    expect(claimSpy).toHaveBeenCalledTimes(2);
    expect(killSpy).toHaveBeenCalledTimes(1);
    expect(nightActionSpy).toHaveBeenCalledTimes(1);

    const replies = safeReply.mock.calls.map(([, payload]) => String(payload.content || ''));
    expect(replies.some(content => content.includes('tiré sur'))).toBe(true);
    expect(replies.some(content => content.includes('ne peux tirer'))).toBe(true);

    duplicateSpy.mockRestore();
    claimSpy.mockRestore();
    killSpy.mockRestore();
    nightActionSpy.mockRestore();
  });
});
