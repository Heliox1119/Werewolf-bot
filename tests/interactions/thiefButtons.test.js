/**
 * Tests for interactions/thiefButtons.js
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
jest.mock('../../utils/validators', () => ({
  isInGameCategory: jest.fn(async () => true),
}));

const { handleThiefButton } = require('../../interactions/thiefButtons');

/**
 * Helper: create a deferred button interaction for the thief
 */
function createButtonInteraction(customId, channelId = 'thief-channel', userId = 'thief-player') {
  const interaction = createMockInteraction({ channelId, userId });
  interaction.customId = customId;
  interaction.deferred = true; // buttons are pre-deferred by index.js
  interaction.replied = false;
  return interaction;
}

describe('interactions/thiefButtons - handleThiefButton', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    gameManager.runAtomic = jest.fn(async (channelId, fn) => {
      const game = gameManager.getGameByChannelId(channelId);
      fn(game);
    });
    gameManager.clearNightAfkTimeout = jest.fn();
    gameManager.logAction = jest.fn();
    gameManager.advanceSubPhase = jest.fn();
    gameManager.updateChannelPermissions = jest.fn();
    gameManager.db = {
      updatePlayer: jest.fn(() => ({})),
      addNightAction: jest.fn(() => ({})),
    };
  });

  // ─── Steal Card 1 ────────────────────────────────────────────────

  describe('thief_steal:1', () => {

    it('replies with error when guards fail (no game)', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const interaction = createButtonInteraction('thief_steal:1');

      await handleThiefButton(interaction);

      expect(interaction._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('swaps role to card 1 and advances sub-phase', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_steal:1');
      await handleThiefButton(interaction);

      expect(gameManager.runAtomic).toHaveBeenCalledWith('main-channel', expect.any(Function));
      expect(gameManager.advanceSubPhase).toHaveBeenCalledWith(interaction.guild, game);
      // Player role should have been changed inside runAtomic
      expect(player.role).toBe(ROLES.SEER);
    });

    it('updates wolf channel permissions when stealing a wolf role', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.WEREWOLF, ROLES.SEER],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_steal:1');
      await handleThiefButton(interaction);

      expect(gameManager.updateChannelPermissions).toHaveBeenCalledWith(interaction.guild, game);
    });

    it('does not update wolf channels when stealing a non-wolf role', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_steal:1');
      await handleThiefButton(interaction);

      expect(gameManager.updateChannelPermissions).not.toHaveBeenCalled();
    });
  });

  // ─── Steal Card 2 ────────────────────────────────────────────────

  describe('thief_steal:2', () => {

    it('swaps role to card 2 and advances sub-phase', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_steal:2');
      await handleThiefButton(interaction);

      expect(gameManager.runAtomic).toHaveBeenCalled();
      expect(gameManager.advanceSubPhase).toHaveBeenCalled();
      expect(player.role).toBe(ROLES.WITCH);
    });
  });

  // ─── Steal invalid choice ────────────────────────────────────────

  describe('thief_steal:invalid', () => {

    it('replies error for non-numeric choice', async () => {
      const interaction = createButtonInteraction('thief_steal:abc');
      // No game needed — validation happens on choice before guards
      await handleThiefButton(interaction);
      expect(interaction._replyContent).toBeDefined();
      expect(gameManager.runAtomic).not.toHaveBeenCalled();
    });

    it('replies error for choice=0', async () => {
      const interaction = createButtonInteraction('thief_steal:0');
      await handleThiefButton(interaction);
      expect(interaction._replyContent).toBeDefined();
      expect(gameManager.runAtomic).not.toHaveBeenCalled();
    });
  });

  // ─── Skip ────────────────────────────────────────────────────────

  describe('thief_skip', () => {

    it('replies with error when guards fail (no game)', async () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      const interaction = createButtonInteraction('thief_skip');

      await handleThiefButton(interaction);

      expect(interaction._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });

    it('skips and advances sub-phase when valid', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_skip');
      await handleThiefButton(interaction);

      expect(gameManager.clearNightAfkTimeout).toHaveBeenCalledWith(game);
      expect(gameManager.logAction).toHaveBeenCalled();
      expect(gameManager.advanceSubPhase).toHaveBeenCalledWith(interaction.guild, game);
    });

    it('blocks skip when both cards are wolves', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.WEREWOLF, ROLES.WHITE_WOLF],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);

      const interaction = createButtonInteraction('thief_skip');
      await handleThiefButton(interaction);

      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });

  // ─── Atomic failure ──────────────────────────────────────────────

  describe('error handling', () => {

    it('replies with internal error when runAtomic throws', async () => {
      const player = createMockPlayer({ id: 'thief-player', role: ROLES.THIEF });
      const game = createMockGame({
        mainChannelId: 'main-channel',
        thiefChannelId: 'thief-channel',
        phase: PHASES.NIGHT,
        subPhase: PHASES.VOLEUR,
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      gameManager.runAtomic.mockRejectedValue(new Error('Atomic failure'));

      const interaction = createButtonInteraction('thief_steal:1');
      await handleThiefButton(interaction);

      expect(interaction._replyContent).toBeDefined();
      expect(gameManager.advanceSubPhase).not.toHaveBeenCalled();
    });
  });
});
