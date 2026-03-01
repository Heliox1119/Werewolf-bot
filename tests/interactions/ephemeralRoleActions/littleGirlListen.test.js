/**
 * Tests for interactions/ephemeralRoleActions/littleGirlListen.js
 * — handleLittleGirlListen (button handler)
 * — buildLittleGirlPrompt (embed + button builder)
 */

const ROLES = require('../../../game/roles');
const PHASES = require('../../../game/phases');
const gameManager = require('../../../game/gameManager');
const { createMockInteraction, createMockGame, createMockPlayer } = require('../../helpers/testHelpers');

jest.mock('../../../game/gameManager');
jest.mock('../../../utils/logger', () => ({
  app: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  commands: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) },
  interaction: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../utils/validators', () => ({
  isInGameCategory: jest.fn(async () => true),
}));

const {
  handleLittleGirlListen,
  buildLittleGirlPrompt,
} = require('../../../interactions/ephemeralRoleActions/littleGirlListen');

// ─── Helpers ───────────────────────────────────────────────────────

function makeGame(overrides = {}) {
  return createMockGame({
    mainChannelId: 'main-ch',
    guildId: 'guild-1',
    phase: PHASES.NIGHT,
    subPhase: PHASES.LOUPS,
    wolvesChannelId: 'wolves-ch',
    villageRolesPowerless: false,
    listenRelayUserId: null,
    listenHintsGiven: [],
    players: [
      createMockPlayer({ id: 'lgirl', username: 'Alice', role: ROLES.PETITE_FILLE }),
      createMockPlayer({ id: 'wolf1', username: 'Bob', role: ROLES.WEREWOLF }),
      createMockPlayer({ id: 'v1', username: 'Carol', role: ROLES.VILLAGER }),
    ],
    ...overrides,
  });
}

function makeButtonInteraction(userId = 'lgirl', channelId = 'village-ch') {
  const i = createMockInteraction({ channelId, userId, guildId: 'guild-1' });
  i.customId = 'lgirl_listen';
  i.deferred = true;
  i.replied = false;
  // Override user.send with a jest.fn so we can assert on it
  i.user.send = jest.fn(async () => ({ id: 'dm-msg' }));
  // Mock guild.channels.fetch for wolves channel
  i.guild.channels.fetch = jest.fn(async (chId) => ({
    id: chId,
    send: jest.fn(),
  }));
  return i;
}

function setupGameManager() {
  gameManager.logAction = jest.fn();
  gameManager.runAtomic = jest.fn(async (chId, fn) => {
    const game = gameManager.getGameByChannelId(chId);
    return fn(game);
  });
  gameManager.games = new Map();
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('handleLittleGirlListen', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    setupGameManager();
  });

  test('activates relay and responds with confirmation', async () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    // Relay activated
    expect(game.listenRelayUserId).toBe('lgirl');
    // DM sent
    expect(i.user.send).toHaveBeenCalled();
    // Ephemeral reply
    expect(i._replyContent).toBeDefined();
    // Logged
    expect(gameManager.logAction).toHaveBeenCalled();
  });

  test('rejects when guard fails (wrong phase)', async () => {
    const game = makeGame({ phase: PHASES.DAY });
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    expect(i._replyContent).toBeDefined();
    expect(gameManager.runAtomic).not.toHaveBeenCalled();
  });

  test('rejects when already listening', async () => {
    const game = makeGame({ listenRelayUserId: 'lgirl' });
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    expect(i._replyContent).toBeDefined();
    expect(gameManager.runAtomic).not.toHaveBeenCalled();
  });

  test('rolls back relay on error', async () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);

    // First runAtomic succeeds (activating relay)
    // Then user.send throws
    const i = makeButtonInteraction();
    i.user.send = jest.fn().mockRejectedValueOnce(new Error('DM blocked'));

    // runAtomic is called twice: once to activate, once to rollback
    let callCount = 0;
    gameManager.runAtomic.mockImplementation(async (chId, fn) => {
      callCount++;
      if (callCount === 1) {
        return fn(game); // activate
      }
      return fn(game); // rollback
    });

    await handleLittleGirlListen(i);

    // Should have called runAtomic twice (activate + rollback)
    expect(gameManager.runAtomic).toHaveBeenCalledTimes(2);
    // Relay should be rolled back
    expect(game.listenRelayUserId).toBeNull();
  });
});

describe('buildLittleGirlPrompt', () => {

  test('returns embed with correct title', () => {
    const result = buildLittleGirlPrompt('guild-1');
    expect(result.embeds).toHaveLength(1);
    const embed = result.embeds[0];
    expect(embed.data.title).toContain('Petite Fille');
  });

  test('returns a single action row with one button', () => {
    const result = buildLittleGirlPrompt('guild-1');
    expect(result.components).toHaveLength(1);
    const row = result.components[0];
    expect(row.components).toHaveLength(1);
    const btn = row.components[0];
    expect(btn.data.custom_id || btn.data.customId).toBe('lgirl_listen');
  });

  test('button has Primary style', () => {
    const result = buildLittleGirlPrompt('guild-1');
    const btn = result.components[0].components[0];
    // ButtonStyle.Primary = 1
    expect(btn.data.style).toBe(1);
  });
});
