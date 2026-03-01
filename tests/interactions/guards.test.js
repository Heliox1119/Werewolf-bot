/**
 * Tests for interactions/common/guards.js
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

const { validateThiefSteal, validateThiefSkip } = require('../../interactions/common/guards');

describe('interactions/common/guards', () => {
  let interaction;

  beforeEach(() => {
    jest.clearAllMocks();
    interaction = createMockInteraction({
      channelId: 'thief-channel',
      userId: 'thief-player',
    });
  });

  // ─── validateThiefSteal ──────────────────────────────────────────

  describe('validateThiefSteal', () => {

    it('returns ok:false when no game exists', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
      expect(result.message).toBeDefined();
    });

    it('returns ok:false when channel is not the thief channel', () => {
      const game = createMockGame({
        thiefChannelId: 'other-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when phase is not NIGHT', () => {
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.DAY,
        subPhase: PHASES.VOLEUR,
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when subPhase is not VOLEUR', () => {
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.LOUPS,
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when player is not the thief', () => {
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.VILLAGER })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when player is dead', () => {
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF, alive: false })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when no thief cards are available', () => {
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [],
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:true with game and player when all guards pass', () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSteal(interaction);
      expect(result.ok).toBe(true);
      expect(result.game).toBe(game);
      expect(result.player).toBe(player);
    });
  });

  // ─── validateThiefSkip ───────────────────────────────────────────

  describe('validateThiefSkip', () => {

    it('returns ok:false when no game exists', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when phase is not NIGHT', () => {
      const game = createMockGame({
        phase: PHASES.DAY,
        subPhase: PHASES.VOLEUR,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when player is dead', () => {
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF, alive: false })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when player is not the thief', () => {
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.VILLAGER })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when subPhase is not VOLEUR', () => {
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:false when both cards are wolves (must-take rule)', () => {
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.WEREWOLF, ROLES.WHITE_WOLF],
        players: [createMockPlayer({ id: 'thief-player', role: ROLES.THIEF })],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(false);
    });

    it('returns ok:true when guards pass and cards are not both wolves', () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(true);
      expect(result.game).toBe(game);
      expect(result.player).toBe(player);
    });

    it('returns ok:true when thief has no extra roles (skip still allowed)', () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const result = validateThiefSkip(interaction);
      expect(result.ok).toBe(true);
    });
  });
});
