/**
 * Tests for interactions/ephemeralRoleActions/littleGirlListen.js
 * — handleLittleGirlListen (button handler)
 * — generateAmbiguousHint (hint generator)
 *
 * Updated for new mechanic: exposure system, wolf reveal, ambiguous hints
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
  generateAmbiguousHint,
  HINT_TEMPLATES,
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
    littleGirlListenedThisNight: false,
    littleGirlExposed: false,
    littleGirlExposureLevel: 0,
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

  test('marks listened this night and increments exposure', async () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    // State updated
    expect(game.littleGirlListenedThisNight).toBe(true);
    expect(game.littleGirlExposureLevel).toBe(1);
    // Ephemeral reply sent
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

  test('rejects when already listened this night', async () => {
    const game = makeGame({ littleGirlListenedThisNight: true });
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    expect(i._replyContent).toBeDefined();
    expect(gameManager.runAtomic).not.toHaveBeenCalled();
  });

  test('rejects when Little Girl is exposed', async () => {
    const game = makeGame({ littleGirlExposed: true });
    gameManager.getGameByChannelId.mockReturnValue(game);

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    expect(i._replyContent).toBeDefined();
    expect(gameManager.runAtomic).not.toHaveBeenCalled();
  });

  test('sends hint to wolves channel', async () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);

    const wolvesSend = jest.fn();
    const i = makeButtonInteraction();
    i.guild.channels.fetch = jest.fn(async () => ({ id: 'wolves-ch', send: wolvesSend }));

    await handleLittleGirlListen(i);

    // Wolves channel should receive at least the hint
    expect(wolvesSend).toHaveBeenCalled();
  });

  test('triggers exposure when threshold reached', async () => {
    // 1 wolf alive → maxExposure = 1 + 1 = 2
    // Start at exposure 1, after listen it becomes 2 → exposed
    const game = makeGame({
      littleGirlExposureLevel: 1,
      players: [
        createMockPlayer({ id: 'lgirl', username: 'Alice', role: ROLES.PETITE_FILLE }),
        createMockPlayer({ id: 'wolf1', username: 'Bob', role: ROLES.WEREWOLF }),
        createMockPlayer({ id: 'v1', username: 'Carol', role: ROLES.VILLAGER }),
      ],
    });
    gameManager.getGameByChannelId.mockReturnValue(game);

    const wolvesSend = jest.fn();
    const i = makeButtonInteraction();
    i.guild.channels.fetch = jest.fn(async () => ({ id: 'wolves-ch', send: wolvesSend }));

    await handleLittleGirlListen(i);

    expect(game.littleGirlExposed).toBe(true);
    expect(game.littleGirlExposureLevel).toBe(2);
    // Identity reveal sent to wolves (hint + identity = 2 sends)
    expect(wolvesSend).toHaveBeenCalledTimes(2);
  });

  test('handles runAtomic error gracefully', async () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);
    gameManager.runAtomic.mockRejectedValueOnce(new Error('atomic fail'));

    const i = makeButtonInteraction();
    await handleLittleGirlListen(i);

    // Should reply with error message
    expect(i._replyContent).toBeDefined();
  });
});

describe('generateAmbiguousHint', () => {

  test('returns a hint when matching hints exist', () => {
    const lgirl = createMockPlayer({ id: 'lgirl', username: 'Alice', role: ROLES.PETITE_FILLE });
    const state = {
      players: [
        lgirl,
        createMockPlayer({ id: 'wolf1', username: 'Andre', role: ROLES.WEREWOLF }),
        createMockPlayer({ id: 'v1', username: 'Bob', role: ROLES.VILLAGER }),
      ],
    };
    const hint = generateAmbiguousHint(lgirl, state, 'guild-1');
    expect(hint).toBeDefined();
    expect(typeof hint).toBe('string');
  });

  test('returns generic hint when no matching hints exist', () => {
    // Construct a scenario where no hint template matches 2+ players
    const lgirl = createMockPlayer({ id: 'lgirl', username: 'X', role: ROLES.PETITE_FILLE });
    const state = {
      players: [lgirl], // Only 1 player alive
    };
    const hint = generateAmbiguousHint(lgirl, state, 'guild-1');
    expect(hint).toBeDefined();
    expect(typeof hint).toBe('string');
  });

  test('HINT_TEMPLATES are well-formed', () => {
    expect(HINT_TEMPLATES.length).toBeGreaterThan(0);
    for (const tmpl of HINT_TEMPLATES) {
      expect(typeof tmpl.test).toBe('function');
      expect(typeof tmpl.key).toBe('string');
    }
  });
});
