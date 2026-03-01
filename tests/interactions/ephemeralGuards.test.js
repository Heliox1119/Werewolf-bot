/**
 * Tests for interactions/common/guards.js — validateLittleGirlListen
 */

const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const gameManager = require('../../game/gameManager');
const { createMockInteraction, createMockGame, createMockPlayer } = require('../helpers/testHelpers');

jest.mock('../../game/gameManager');
jest.mock('../../utils/logger', () => ({
  app: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  commands: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), startTimer: jest.fn(() => ({ end: jest.fn() })) },
  interaction: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { validateLittleGirlListen } = require('../../interactions/common/guards');

describe('validateLittleGirlListen', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    gameManager.games = new Map();
  });

  function makeGame(overrides = {}) {
    return createMockGame({
      mainChannelId: 'main',
      guildId: 'guild-1',
      phase: PHASES.NIGHT,
      subPhase: PHASES.LOUPS,
      wolvesChannelId: 'wolves-ch',
      villageRolesPowerless: false,
      listenRelayUserId: null,
      players: [
        createMockPlayer({ id: 'lgirl', username: 'Alice', role: ROLES.PETITE_FILLE }),
        createMockPlayer({ id: 'wolf1', username: 'Bob', role: ROLES.WEREWOLF }),
        createMockPlayer({ id: 'v1', username: 'Carol', role: ROLES.VILLAGER }),
      ],
      ...overrides,
    });
  }

  function makeInteraction(userId = 'lgirl', channelId = 'village-ch') {
    const i = createMockInteraction({ channelId, userId, guildId: 'guild-1' });
    return i;
  }

  test('returns ok when all conditions met (game found by channelId)', () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(true);
    expect(result.game).toBe(game);
    expect(result.player.id).toBe('lgirl');
  });

  test('returns ok when game found by guildId fallback', () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(null);
    gameManager.games = new Map([['main', game]]);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(true);
  });

  test('fails when no game found', () => {
    gameManager.getGameByChannelId.mockReturnValue(null);
    gameManager.games = new Map();
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('aucune');
  });

  test('fails when player is not Petite Fille', () => {
    const game = makeGame();
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction('wolf1');
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when player is dead', () => {
    const game = makeGame({
      players: [
        createMockPlayer({ id: 'lgirl', username: 'Alice', role: ROLES.PETITE_FILLE, alive: false }),
        createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF }),
      ],
    });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when villageRolesPowerless', () => {
    const game = makeGame({ villageRolesPowerless: true });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when phase is not NIGHT', () => {
    const game = makeGame({ phase: PHASES.DAY });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when subPhase is not LOUPS', () => {
    const game = makeGame({ subPhase: PHASES.VOYANTE });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when wolvesChannelId is missing', () => {
    const game = makeGame({ wolvesChannelId: null });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });

  test('fails when already listening', () => {
    const game = makeGame({ listenRelayUserId: 'lgirl' });
    gameManager.getGameByChannelId.mockReturnValue(game);
    const i = makeInteraction();
    const result = validateLittleGirlListen(i);
    expect(result.ok).toBe(false);
  });
});
