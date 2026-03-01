/**
 * Tests for interactions/common/guards.js — Night role guards
 * (wolves, white wolf, seer, salvateur, witch, cupid, generic skip)
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

const {
  validateWolfKill,
  validateWhiteWolfKill,
  validateSeerSee,
  validateSalvateurProtect,
  validateWitchBase,
  validateWitchLife,
  validateWitchDeath,
  validateWitchSkip,
  validateCupidLove,
  validateSkip,
} = require('../../interactions/common/guards');

describe('Night role guards', () => {

  beforeEach(() => jest.clearAllMocks());

  // ═══ validateWolfKill ════════════════════════════════════════════

  describe('validateWolfKill', () => {
    const mkInteraction = (chId = 'wolves-ch') =>
      createMockInteraction({ channelId: chId, userId: 'wolf1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('fails when wrong channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ wolvesChannelId: 'other' })
      );
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('fails when not NIGHT', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ wolvesChannelId: 'wolves-ch', phase: PHASES.DAY })
      );
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('fails when subPhase is not LOUPS', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ wolvesChannelId: 'wolves-ch', phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE })
      );
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('fails when player is not a wolf', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        wolvesChannelId: 'wolves-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'wolf1', role: ROLES.VILLAGER })],
      }));
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('fails when target is a wolf', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        wolvesChannelId: 'wolves-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [
          createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'wolf2', role: ROLES.WEREWOLF }),
        ],
      }));
      expect(validateWolfKill(mkInteraction(), 'wolf2').ok).toBe(false);
    });

    it('fails when target is dead', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        wolvesChannelId: 'wolves-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [
          createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'v1', role: ROLES.VILLAGER, alive: false }),
        ],
      }));
      expect(validateWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('succeeds with valid wolf and target', () => {
      const wolf = createMockPlayer({ id: 'wolf1', role: ROLES.WEREWOLF });
      const villager = createMockPlayer({ id: 'v1', role: ROLES.VILLAGER });
      const game = createMockGame({
        wolvesChannelId: 'wolves-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [wolf, villager],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const result = validateWolfKill(mkInteraction(), 'v1');
      expect(result.ok).toBe(true);
      expect(result.game).toBe(game);
      expect(result.player).toBe(wolf);
      expect(result.target).toBe(villager);
    });
  });

  // ═══ validateWhiteWolfKill ═══════════════════════════════════════

  describe('validateWhiteWolfKill', () => {
    const mkInteraction = (chId = 'ww-ch') =>
      createMockInteraction({ channelId: chId, userId: 'ww1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateWhiteWolfKill(mkInteraction(), 'w1').ok).toBe(false);
    });

    it('fails when not in white wolf channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ whiteWolfChannelId: 'other' })
      );
      expect(validateWhiteWolfKill(mkInteraction(), 'w1').ok).toBe(false);
    });

    it('fails when subPhase is not LOUP_BLANC', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        whiteWolfChannelId: 'ww-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF })],
      }));
      expect(validateWhiteWolfKill(mkInteraction(), 'w1').ok).toBe(false);
    });

    it('fails when player is not the white wolf', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        whiteWolfChannelId: 'ww-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUP_BLANC,
        players: [createMockPlayer({ id: 'ww1', role: ROLES.VILLAGER })],
      }));
      expect(validateWhiteWolfKill(mkInteraction(), 'w1').ok).toBe(false);
    });

    it('fails when target is not a regular werewolf', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        whiteWolfChannelId: 'ww-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUP_BLANC,
        players: [
          createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF }),
          createMockPlayer({ id: 'v1', role: ROLES.VILLAGER }),
        ],
      }));
      expect(validateWhiteWolfKill(mkInteraction(), 'v1').ok).toBe(false);
    });

    it('succeeds when targeting a regular werewolf', () => {
      const ww = createMockPlayer({ id: 'ww1', role: ROLES.WHITE_WOLF });
      const wolf = createMockPlayer({ id: 'w1', role: ROLES.WEREWOLF });
      const game = createMockGame({
        whiteWolfChannelId: 'ww-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUP_BLANC,
        players: [ww, wolf],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const result = validateWhiteWolfKill(mkInteraction(), 'w1');
      expect(result.ok).toBe(true);
      expect(result.target).toBe(wolf);
    });
  });

  // ═══ validateSeerSee ═════════════════════════════════════════════

  describe('validateSeerSee', () => {
    const mkInteraction = (chId = 'seer-ch') =>
      createMockInteraction({ channelId: chId, userId: 'seer1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when wrong channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ seerChannelId: 'other' })
      );
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when not NIGHT', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.DAY, subPhase: PHASES.VOYANTE,
      }));
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when subPhase is not VOYANTE', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
      }));
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when player is not the seer', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [createMockPlayer({ id: 'seer1', role: ROLES.VILLAGER })],
      }));
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when villageRolesPowerless is true', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        villageRolesPowerless: true,
        players: [createMockPlayer({ id: 'seer1', role: ROLES.SEER })],
      }));
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when target is dead', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [
          createMockPlayer({ id: 'seer1', role: ROLES.SEER }),
          createMockPlayer({ id: 't1', role: ROLES.VILLAGER, alive: false }),
        ],
      }));
      expect(validateSeerSee(mkInteraction(), 't1').ok).toBe(false);
    });

    it('succeeds with valid seer and target', () => {
      const seer = createMockPlayer({ id: 'seer1', role: ROLES.SEER });
      const target = createMockPlayer({ id: 't1', role: ROLES.WEREWOLF });
      const game = createMockGame({
        seerChannelId: 'seer-ch', phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [seer, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const r = validateSeerSee(mkInteraction(), 't1');
      expect(r.ok).toBe(true);
      expect(r.target).toBe(target);
    });
  });

  // ═══ validateSalvateurProtect ════════════════════════════════════

  describe('validateSalvateurProtect', () => {
    const mkInteraction = (chId = 'salv-ch') =>
      createMockInteraction({ channelId: chId, userId: 'salv1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails in wrong channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ salvateurChannelId: 'other' })
      );
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when subPhase is not SALVATEUR', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR })],
      }));
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when player is not salvateur', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        players: [createMockPlayer({ id: 'salv1', role: ROLES.VILLAGER })],
      }));
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when trying to protect self', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        players: [
          createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR }),
          createMockPlayer({ id: 't1' }),
        ],
      }));
      expect(validateSalvateurProtect(mkInteraction(), 'salv1').ok).toBe(false);
    });

    it('fails when protecting same player as last night', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        lastProtectedPlayerId: 't1',
        players: [
          createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR }),
          createMockPlayer({ id: 't1' }),
        ],
      }));
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when villageRolesPowerless', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        villageRolesPowerless: true,
        players: [createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR })],
      }));
      expect(validateSalvateurProtect(mkInteraction(), 't1').ok).toBe(false);
    });

    it('succeeds with valid target', () => {
      const salv = createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR });
      const target = createMockPlayer({ id: 't1' });
      const game = createMockGame({
        salvateurChannelId: 'salv-ch', phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        players: [salv, target],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const r = validateSalvateurProtect(mkInteraction(), 't1');
      expect(r.ok).toBe(true);
      expect(r.target).toBe(target);
    });
  });

  // ═══ validateWitchBase / Life / Death / Skip ═════════════════════

  describe('validateWitchBase', () => {
    const mkInteraction = (chId = 'witch-ch') =>
      createMockInteraction({ channelId: chId, userId: 'witch1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('fails in wrong channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ witchChannelId: 'other' })
      );
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('fails when not NIGHT', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.DAY, subPhase: PHASES.SORCIERE,
      }));
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('fails when subPhase not SORCIERE', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
      }));
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('fails when player is not witch', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        players: [createMockPlayer({ id: 'witch1', role: ROLES.VILLAGER })],
      }));
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('fails when villageRolesPowerless', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        villageRolesPowerless: true,
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchBase(mkInteraction()).ok).toBe(false);
    });

    it('succeeds with valid witch', () => {
      const witch = createMockPlayer({ id: 'witch1', role: ROLES.WITCH });
      const game = createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        players: [witch],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const r = validateWitchBase(mkInteraction());
      expect(r.ok).toBe(true);
    });
  });

  describe('validateWitchLife', () => {
    const mkInteraction = (chId = 'witch-ch') =>
      createMockInteraction({ channelId: chId, userId: 'witch1' });

    it('fails when no life potion', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: false, death: true },
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchLife(mkInteraction()).ok).toBe(false);
    });

    it('fails when no nightVictim', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        nightVictim: null,
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchLife(mkInteraction()).ok).toBe(false);
    });

    it('succeeds when life potion and nightVictim present', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        nightVictim: 'victim1',
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchLife(mkInteraction()).ok).toBe(true);
    });
  });

  describe('validateWitchDeath', () => {
    const mkInteraction = (chId = 'witch-ch') =>
      createMockInteraction({ channelId: chId, userId: 'witch1' });

    it('fails when no death potion', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: false },
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchDeath(mkInteraction(), 't1').ok).toBe(false);
    });

    it('fails when target is self', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        players: [createMockPlayer({ id: 'witch1', role: ROLES.WITCH })],
      }));
      expect(validateWitchDeath(mkInteraction(), 'witch1').ok).toBe(false);
    });

    it('fails when target is dead', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        players: [
          createMockPlayer({ id: 'witch1', role: ROLES.WITCH }),
          createMockPlayer({ id: 't1', alive: false }),
        ],
      }));
      expect(validateWitchDeath(mkInteraction(), 't1').ok).toBe(false);
    });

    it('succeeds with valid target', () => {
      const target = createMockPlayer({ id: 't1' });
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        witchChannelId: 'witch-ch', phase: PHASES.NIGHT, subPhase: PHASES.SORCIERE,
        witchPotions: { life: true, death: true },
        players: [
          createMockPlayer({ id: 'witch1', role: ROLES.WITCH }),
          target,
        ],
      }));
      const r = validateWitchDeath(mkInteraction(), 't1');
      expect(r.ok).toBe(true);
      expect(r.target).toBe(target);
    });
  });

  // ═══ validateCupidLove ═══════════════════════════════════════════

  describe('validateCupidLove', () => {
    const mkInteraction = (chId = 'cupid-ch') =>
      createMockInteraction({ channelId: chId, userId: 'cupid1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('fails in wrong channel', () => {
      gameManager.getGameByChannelId.mockReturnValue(
        createMockGame({ cupidChannelId: 'other' })
      );
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('fails when player is not cupid', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        players: [createMockPlayer({ id: 'cupid1', role: ROLES.VILLAGER })],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('fails when lovers already chosen', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [['x', 'y']],
        players: [createMockPlayer({ id: 'cupid1', role: ROLES.CUPID })],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('fails when same target twice', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [],
        players: [
          createMockPlayer({ id: 'cupid1', role: ROLES.CUPID }),
          createMockPlayer({ id: 'a' }),
        ],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'a').ok).toBe(false);
    });

    it('fails when a target is not in game', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [],
        players: [
          createMockPlayer({ id: 'cupid1', role: ROLES.CUPID }),
          createMockPlayer({ id: 'a' }),
        ],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'missing').ok).toBe(false);
    });

    it('fails when a target is dead', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [],
        players: [
          createMockPlayer({ id: 'cupid1', role: ROLES.CUPID }),
          createMockPlayer({ id: 'a' }),
          createMockPlayer({ id: 'b', alive: false }),
        ],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('fails when subPhase is not CUPIDON', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        lovers: [],
        players: [
          createMockPlayer({ id: 'cupid1', role: ROLES.CUPID }),
          createMockPlayer({ id: 'a' }),
          createMockPlayer({ id: 'b' }),
        ],
      }));
      expect(validateCupidLove(mkInteraction(), 'a', 'b').ok).toBe(false);
    });

    it('succeeds with two valid alive players', () => {
      const a = createMockPlayer({ id: 'a' });
      const b = createMockPlayer({ id: 'b' });
      const game = createMockGame({
        cupidChannelId: 'cupid-ch', phase: PHASES.NIGHT, subPhase: PHASES.CUPIDON,
        lovers: [],
        players: [
          createMockPlayer({ id: 'cupid1', role: ROLES.CUPID }),
          a, b,
        ],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const r = validateCupidLove(mkInteraction(), 'a', 'b');
      expect(r.ok).toBe(true);
      expect(r.targetA).toBe(a);
      expect(r.targetB).toBe(b);
    });
  });

  // ═══ validateSkip (generic) ══════════════════════════════════════

  describe('validateSkip', () => {
    const mkInteraction = (chId = 'seer-ch') =>
      createMockInteraction({ channelId: chId, userId: 'seer1' });

    it('fails when no game', () => {
      gameManager.getGameByChannelId.mockReturnValue(null);
      expect(validateSkip(mkInteraction(), ROLES.SEER, PHASES.VOYANTE, 'Voyante').ok).toBe(false);
    });

    it('fails when not NIGHT', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({ phase: PHASES.DAY }));
      expect(validateSkip(mkInteraction(), ROLES.SEER, PHASES.VOYANTE, 'Voyante').ok).toBe(false);
    });

    it('fails when player role does not match', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [createMockPlayer({ id: 'seer1', role: ROLES.VILLAGER })],
      }));
      expect(validateSkip(mkInteraction(), ROLES.SEER, PHASES.VOYANTE, 'Voyante').ok).toBe(false);
    });

    it('fails when subPhase does not match', () => {
      gameManager.getGameByChannelId.mockReturnValue(createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.LOUPS,
        players: [createMockPlayer({ id: 'seer1', role: ROLES.SEER })],
      }));
      expect(validateSkip(mkInteraction(), ROLES.SEER, PHASES.VOYANTE, 'Voyante').ok).toBe(false);
    });

    it('succeeds for valid seer skip', () => {
      const player = createMockPlayer({ id: 'seer1', role: ROLES.SEER });
      const game = createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.VOYANTE,
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      const r = validateSkip(mkInteraction(), ROLES.SEER, PHASES.VOYANTE, 'Voyante');
      expect(r.ok).toBe(true);
      expect(r.player).toBe(player);
    });

    it('works for salvateur skip', () => {
      const mkSInteraction = () => createMockInteraction({ channelId: 'salv-ch', userId: 'salv1' });
      const player = createMockPlayer({ id: 'salv1', role: ROLES.SALVATEUR });
      const game = createMockGame({
        phase: PHASES.NIGHT, subPhase: PHASES.SALVATEUR,
        players: [player],
      });
      gameManager.getGameByChannelId.mockReturnValue(game);
      expect(validateSkip(mkSInteraction(), ROLES.SALVATEUR, PHASES.SALVATEUR, 'Salvateur').ok).toBe(true);
    });
  });
});
