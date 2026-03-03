/**
 * Tests for pruneUnusedRoleChannels — the channel pruning system.
 *
 * Validates that:
 * - Unused role channels are deleted at game start
 * - Channels for active roles (players + thief cards) are kept
 * - Protected channels (village, spectator, voice) are NEVER pruned
 * - Game object fields are nulled after deletion
 * - game_channels DB records are cleaned up
 * - rolePanels entries are cleaned for pruned channels
 * - DB game row is updated with nulled channel IDs
 * - Already-deleted channels are handled gracefully
 * - Wrong-guild channels are skipped safely
 * - Partial failures don't crash the entire prune
 * - ROLE_TO_CHANNEL_FIELDS static map is correct
 * - _safeDeleteChannel handles all edge cases
 */

const gameManagerModule = require('../../game/gameManager');
const { GameManager } = gameManagerModule;
const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const {
  createMockGuild,
  createMockPlayer,
  cleanupTest
} = require('../helpers/testHelpers');
const { Channel } = require('../__mocks__/discord.js');
const fs = require('fs');

jest.mock('fs');

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Create a fully-wired game with all 7 role channels + village/spectator/voice.
 * Returns { gm, game, guild, channels } for easy test setup.
 */
function createFullGame(overrides = {}) {
  const gm = new GameManager();
  fs.writeFileSync = jest.fn();
  fs.existsSync = jest.fn(() => false);
  fs.readFileSync = jest.fn(() => '{}');

  const mainChannelId = 'main-ch-1';
  const guildId = 'guild-1';

  gm.create(mainChannelId, { guildId });
  const game = gm.games.get(mainChannelId);

  // Assign channel IDs
  const channelIds = {
    villageChannelId: 'ch-village',
    wolvesChannelId: 'ch-wolves',
    seerChannelId: 'ch-seer',
    witchChannelId: 'ch-witch',
    cupidChannelId: 'ch-cupid',
    salvateurChannelId: 'ch-salvateur',
    whiteWolfChannelId: 'ch-whiteWolf',
    thiefChannelId: 'ch-thief',
    spectatorChannelId: 'ch-spectator',
    voiceChannelId: 'ch-voice',
    ...overrides.channels,
  };

  Object.assign(game, channelIds);

  // Register in game_channels DB
  const typeMap = {
    villageChannelId: 'village',
    wolvesChannelId: 'wolves',
    seerChannelId: 'seer',
    witchChannelId: 'witch',
    cupidChannelId: 'cupid',
    salvateurChannelId: 'salvateur',
    whiteWolfChannelId: 'whiteWolf',
    thiefChannelId: 'thief',
    spectatorChannelId: 'spectator',
    voiceChannelId: 'voice',
  };
  for (const [field, chType] of Object.entries(typeMap)) {
    if (channelIds[field]) {
      gm.db.registerGameChannel(mainChannelId, guildId, chType, channelIds[field]);
    }
  }

  // Create mock guild with all channels
  const guild = createMockGuild({ id: guildId });
  for (const chId of Object.values(channelIds).filter(Boolean)) {
    const ch = new Channel(chId, chId === 'ch-voice' ? 2 : 0);
    ch.guildId = guildId;
    ch.delete = jest.fn(async () => {});
    ch.permissionOverwrites = new Map();
    ch.permissionOverwrites.edit = jest.fn(async () => {});
    guild.channels.cache.set(chId, ch);
  }

  // Override guild.channels.fetch to return from cache or null
  guild.channels.fetch = jest.fn(async (id, opts) => {
    return guild.channels.cache.get(id) || null;
  });

  // Assign players (overridable)
  game.players = overrides.players || [];
  game.thiefExtraRoles = overrides.thiefExtraRoles || [];

  return { gm, game, guild, channelIds };
}

// ─── Tests ────────────────────────────────────────────────────────

describe('pruneUnusedRoleChannels', () => {
  afterEach(() => {
    cleanupTest();
  });

  // === ROLE_TO_CHANNEL_FIELDS static map ===

  describe('ROLE_TO_CHANNEL_FIELDS', () => {
    test('maps WEREWOLF to wolvesChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.WEREWOLF]).toEqual(['wolvesChannelId']);
    });

    test('maps WHITE_WOLF to both wolvesChannelId and whiteWolfChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.WHITE_WOLF]).toEqual(['wolvesChannelId', 'whiteWolfChannelId']);
    });

    test('maps SEER to seerChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.SEER]).toEqual(['seerChannelId']);
    });

    test('maps WITCH to witchChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.WITCH]).toEqual(['witchChannelId']);
    });

    test('maps CUPID to cupidChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.CUPID]).toEqual(['cupidChannelId']);
    });

    test('maps SALVATEUR to salvateurChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.SALVATEUR]).toEqual(['salvateurChannelId']);
    });

    test('maps THIEF to thiefChannelId', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.THIEF]).toEqual(['thiefChannelId']);
    });

    test('does NOT map VILLAGER (no dedicated channel)', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.VILLAGER]).toBeUndefined();
    });

    test('does NOT map HUNTER (no dedicated channel)', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.HUNTER]).toBeUndefined();
    });

    test('does NOT map ANCIEN (no dedicated channel)', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.ANCIEN]).toBeUndefined();
    });

    test('does NOT map PETITE_FILLE (no dedicated channel)', () => {
      expect(GameManager.ROLE_TO_CHANNEL_FIELDS[ROLES.PETITE_FILLE]).toBeUndefined();
    });
  });

  // === Basic pruning logic ===

  describe('prunes unused channels correctly', () => {
    test('deletes ALL role channels when only VILLAGER roles are in play', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.pruned).toHaveLength(7); // all 7 role channels
      expect(result.kept).toHaveLength(0);
      expect(result.failed).toHaveLength(0);

      // All role channel fields should be nulled
      expect(game.wolvesChannelId).toBeNull();
      expect(game.seerChannelId).toBeNull();
      expect(game.witchChannelId).toBeNull();
      expect(game.cupidChannelId).toBeNull();
      expect(game.salvateurChannelId).toBeNull();
      expect(game.whiteWolfChannelId).toBeNull();
      expect(game.thiefChannelId).toBeNull();

      gm.destroy();
    });

    test('keeps wolves channel when WEREWOLF is in play', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toContain('wolvesChannelId');
      expect(game.wolvesChannelId).toBe('ch-wolves');
      // Other unused channels should be pruned
      expect(game.seerChannelId).toBeNull();
      expect(game.witchChannelId).toBeNull();
      expect(game.cupidChannelId).toBeNull();
      expect(game.salvateurChannelId).toBeNull();
      expect(game.whiteWolfChannelId).toBeNull();
      expect(game.thiefChannelId).toBeNull();

      gm.destroy();
    });

    test('keeps both wolves + whiteWolf channels when WHITE_WOLF is in play', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.WHITE_WOLF }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toContain('whiteWolfChannelId');
      expect(game.wolvesChannelId).toBe('ch-wolves');
      expect(game.whiteWolfChannelId).toBe('ch-whiteWolf');

      gm.destroy();
    });

    test('keeps seer channel when SEER is distributed', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.SEER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toContain('seerChannelId');
      expect(game.seerChannelId).toBe('ch-seer');

      gm.destroy();
    });

    test('keeps witch + cupid + salvateur channels for full 9-player game', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p3', role: ROLES.SEER }),
          createMockPlayer({ id: 'p4', role: ROLES.WITCH }),
          createMockPlayer({ id: 'p5', role: ROLES.HUNTER }),
          createMockPlayer({ id: 'p6', role: ROLES.CUPID }),
          createMockPlayer({ id: 'p7', role: ROLES.SALVATEUR }),
          createMockPlayer({ id: 'p8', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p9', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toContain('seerChannelId');
      expect(result.kept).toContain('witchChannelId');
      expect(result.kept).toContain('cupidChannelId');
      expect(result.kept).toContain('salvateurChannelId');
      // whiteWolf + thief unused
      expect(result.pruned).toContain('whiteWolfChannelId');
      expect(result.pruned).toContain('thiefChannelId');

      gm.destroy();
    });

    test('keeps ALL role channels in full 12-player DYNAMIC game', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p3', role: ROLES.WHITE_WOLF }),
          createMockPlayer({ id: 'p4', role: ROLES.SEER }),
          createMockPlayer({ id: 'p5', role: ROLES.WITCH }),
          createMockPlayer({ id: 'p6', role: ROLES.HUNTER }),
          createMockPlayer({ id: 'p7', role: ROLES.CUPID }),
          createMockPlayer({ id: 'p8', role: ROLES.SALVATEUR }),
          createMockPlayer({ id: 'p9', role: ROLES.THIEF }),
          createMockPlayer({ id: 'p10', role: ROLES.ANCIEN }),
          createMockPlayer({ id: 'p11', role: ROLES.PETITE_FILLE }),
          createMockPlayer({ id: 'p12', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toHaveLength(7); // all 7 role channels kept
      expect(result.pruned).toHaveLength(0);

      gm.destroy();
    });
  });

  // === Thief extra roles logic ===

  describe('thief extra roles keep their channels', () => {
    test('thief extra card SEER keeps seer channel (even if no player has SEER)', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.THIEF }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
        thiefExtraRoles: [ROLES.SEER, ROLES.WITCH],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // thief + wolves kept from players, seer + witch kept from thief cards
      expect(result.kept).toContain('thiefChannelId');
      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toContain('seerChannelId');
      expect(result.kept).toContain('witchChannelId');
      // cupid, salvateur, whiteWolf pruned
      expect(result.pruned).toContain('cupidChannelId');
      expect(result.pruned).toContain('salvateurChannelId');
      expect(result.pruned).toContain('whiteWolfChannelId');

      gm.destroy();
    });

    test('thief extra card WHITE_WOLF keeps both wolves and whiteWolf channels', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.THIEF }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
        thiefExtraRoles: [ROLES.WHITE_WOLF, ROLES.VILLAGER],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toContain('whiteWolfChannelId');

      gm.destroy();
    });
  });

  // === Protected channels ===

  describe('protected channels are NEVER pruned', () => {
    test('village, spectator, and voice channels survive even with zero role matches', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      await gm.pruneUnusedRoleChannels(guild, game);

      // Protected channels are untouched
      expect(game.villageChannelId).toBe('ch-village');
      expect(game.spectatorChannelId).toBe('ch-spectator');
      expect(game.voiceChannelId).toBe('ch-voice');

      // Verify they were NOT deleted in Discord
      const villageCh = guild.channels.cache.get('ch-village');
      expect(villageCh.delete).not.toHaveBeenCalled();
      const spectatorCh = guild.channels.cache.get('ch-spectator');
      expect(spectatorCh.delete).not.toHaveBeenCalled();
      const voiceCh = guild.channels.cache.get('ch-voice');
      expect(voiceCh.delete).not.toHaveBeenCalled();

      gm.destroy();
    });
  });

  // === DB synchronization ===

  describe('DB synchronization', () => {
    test('removes game_channels DB record for each pruned channel', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Before prune: all channels registered
      const beforeChannels = gm.db.getGameChannels('main-ch-1');
      expect(beforeChannels.length).toBe(10); // all 10

      await gm.pruneUnusedRoleChannels(guild, game);

      // After prune: only kept channels remain
      const afterChannels = gm.db.getGameChannels('main-ch-1');
      const remainingTypes = afterChannels.map(c => c.channel_type);

      // wolves kept (werewolf in play), village/spectator/voice untouched by prune
      expect(remainingTypes).toContain('wolves');
      expect(remainingTypes).toContain('village');
      expect(remainingTypes).toContain('spectator');
      expect(remainingTypes).toContain('voice');

      // Pruned types should be gone
      expect(remainingTypes).not.toContain('seer');
      expect(remainingTypes).not.toContain('witch');
      expect(remainingTypes).not.toContain('cupid');
      expect(remainingTypes).not.toContain('salvateur');
      expect(remainingTypes).not.toContain('whiteWolf');
      expect(remainingTypes).not.toContain('thief');

      gm.destroy();
    });

    test('calls db.updateGame with all nulled fields in single batch', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const updateSpy = jest.spyOn(gm.db, 'updateGame');

      await gm.pruneUnusedRoleChannels(guild, game);

      // Should call updateGame once with all 7 nulled fields
      const updateCall = updateSpy.mock.calls.find(
        c => c[0] === 'main-ch-1' && c[1].seerChannelId === null
      );
      expect(updateCall).toBeDefined();
      expect(updateCall[1]).toMatchObject({
        wolvesChannelId: null,
        seerChannelId: null,
        witchChannelId: null,
        cupidChannelId: null,
        salvateurChannelId: null,
        whiteWolfChannelId: null,
        thiefChannelId: null,
      });

      gm.destroy();
    });

    test('does NOT call db.updateGame when nothing is pruned', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.WHITE_WOLF }),
          createMockPlayer({ id: 'p3', role: ROLES.SEER }),
          createMockPlayer({ id: 'p4', role: ROLES.WITCH }),
          createMockPlayer({ id: 'p5', role: ROLES.CUPID }),
          createMockPlayer({ id: 'p6', role: ROLES.SALVATEUR }),
          createMockPlayer({ id: 'p7', role: ROLES.THIEF }),
          createMockPlayer({ id: 'p8', role: ROLES.VILLAGER }),
        ],
      });

      const updateSpy = jest.spyOn(gm.db, 'updateGame');
      const callsBefore = updateSpy.mock.calls.length;

      await gm.pruneUnusedRoleChannels(guild, game);

      // No new calls to updateGame from pruning (may have been called during create)
      const pruneCalls = updateSpy.mock.calls.slice(callsBefore).filter(
        c => c[1] && (c[1].seerChannelId !== undefined || c[1].wolvesChannelId !== undefined)
      );
      expect(pruneCalls).toHaveLength(0);

      gm.destroy();
    });
  });

  // === rolePanels cleanup ===

  describe('rolePanels cleanup', () => {
    test('removes panel entries for pruned channels', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.SEER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Simulated existing panels
      gm.rolePanels.set('main-ch-1', {
        wolves: { id: 'msg-wolves' },
        seer: { id: 'msg-seer' },
        witch: { id: 'msg-witch' },
        cupid: { id: 'msg-cupid' },
        salvateur: { id: 'msg-salvateur' },
        white_wolf: { id: 'msg-whiteWolf' },
        thief: { id: 'msg-thief' },
      });

      await gm.pruneUnusedRoleChannels(guild, game);

      const panels = gm.rolePanels.get('main-ch-1');
      // Kept: wolves, seer
      expect(panels.wolves).toBeDefined();
      expect(panels.seer).toBeDefined();
      // Pruned: witch, cupid, salvateur, white_wolf, thief
      expect(panels.witch).toBeUndefined();
      expect(panels.cupid).toBeUndefined();
      expect(panels.salvateur).toBeUndefined();
      expect(panels.white_wolf).toBeUndefined();
      expect(panels.thief).toBeUndefined();

      gm.destroy();
    });

    test('handles missing rolePanels map gracefully', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // No rolePanels entry = no crash
      expect(gm.rolePanels.has('main-ch-1')).toBe(false);

      const result = await gm.pruneUnusedRoleChannels(guild, game);
      expect(result.pruned).toHaveLength(7);

      gm.destroy();
    });
  });

  // === Edge cases ===

  describe('edge cases', () => {
    test('handles already-deleted channels (fetch returns null)', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Remove seer channel from cache (simulates manual deletion)
      guild.channels.cache.delete('ch-seer');

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // seer should still show as pruned (already gone = success)
      expect(result.pruned).toContain('seerChannelId');
      expect(game.seerChannelId).toBeNull();

      gm.destroy();
    });

    test('handles channel.delete() throwing an error', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Make witch channel deletion fail with a non-recoverable error
      const witchCh = guild.channels.cache.get('ch-witch');
      witchCh.delete = jest.fn(async () => { throw Object.assign(new Error('Missing Perms'), { code: 50013 }); });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // witch should be in failed, NOT pruned
      expect(result.failed).toContain('witchChannelId');
      // Game field should NOT be nulled for failed channels
      expect(game.witchChannelId).toBe('ch-witch');

      // Other channels should still be pruned
      expect(result.pruned).toContain('seerChannelId');
      expect(game.seerChannelId).toBeNull();

      gm.destroy();
    });

    test('handles channel in wrong guild', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Simulate cupid channel belonging to a different guild
      const cupidCh = guild.channels.cache.get('ch-cupid');
      cupidCh.guildId = 'other-guild-999';

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // cupid should be in failed (wrong guild = skip)
      expect(result.failed).toContain('cupidChannelId');
      expect(game.cupidChannelId).toBe('ch-cupid');

      gm.destroy();
    });

    test('handles empty players array gracefully', async () => {
      const { gm, game, guild } = createFullGame({
        players: [],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // No roles = all channels pruned
      expect(result.pruned).toHaveLength(7);

      gm.destroy();
    });

    test('handles null channel fields gracefully', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Some channels were never created
      game.whiteWolfChannelId = null;
      game.thiefChannelId = null;

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // 5 channels pruned (those that exist), 0 failed
      // whiteWolf + thief skipped (null → not counted)
      expect(result.pruned).toHaveLength(5);
      expect(result.failed).toHaveLength(0);

      gm.destroy();
    });

    test('Unknown Channel error code (10003) is treated as success', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      // Simulate 10003 error on seer channel
      const seerCh = guild.channels.cache.get('ch-seer');
      seerCh.delete = jest.fn(async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // 10003 = already gone → treated as successful prune
      expect(result.pruned).toContain('seerChannelId');
      expect(game.seerChannelId).toBeNull();

      gm.destroy();
    });

    test('handles duplicate roles in player list (multiple werewolves)', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p3', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      // Only wolves channel kept (3 werewolves = 1 wolves channel needed)
      expect(result.kept).toContain('wolvesChannelId');
      expect(result.kept).toHaveLength(1);
      expect(result.pruned).toHaveLength(6);

      gm.destroy();
    });
  });

  // === _safeDeleteChannel ===

  describe('_safeDeleteChannel', () => {
    test('returns true when channel is successfully deleted', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      const ch = new Channel('ch-1', 0);
      ch.guildId = 'g1';
      ch.delete = jest.fn(async () => {});
      ch.permissionOverwrites = new Map();
      ch.permissionOverwrites.edit = jest.fn(async () => {});
      guild.channels.cache.set('ch-1', ch);
      guild.channels.fetch = jest.fn(async (id) => guild.channels.cache.get(id) || null);

      const result = await gm._safeDeleteChannel(guild, 'ch-1');
      expect(result).toBe(true);
      expect(ch.delete).toHaveBeenCalled();

      gm.destroy();
    });

    test('returns true when channel does not exist (already deleted)', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      guild.channels.fetch = jest.fn(async () => null);

      const result = await gm._safeDeleteChannel(guild, 'nonexistent');
      expect(result).toBe(true);

      gm.destroy();
    });

    test('returns false when channel belongs to wrong guild', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      const ch = new Channel('ch-1', 0);
      ch.guildId = 'other-guild';
      ch.delete = jest.fn(async () => {});
      guild.channels.cache.set('ch-1', ch);
      guild.channels.fetch = jest.fn(async (id) => guild.channels.cache.get(id) || null);

      const result = await gm._safeDeleteChannel(guild, 'ch-1');
      expect(result).toBe(false);
      expect(ch.delete).not.toHaveBeenCalled();

      gm.destroy();
    });

    test('unmutes voice channel members before deletion', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      const voiceCh = new Channel('voice-1', 2);
      voiceCh.guildId = 'g1';
      voiceCh.delete = jest.fn(async () => {});
      voiceCh.permissionOverwrites = new Map();
      voiceCh.permissionOverwrites.edit = jest.fn(async () => {});
      // Add mock members
      const mockSetMute = jest.fn(async () => {});
      voiceCh.members = new Map([
        ['m1', { voice: { setMute: mockSetMute } }],
        ['m2', { voice: { setMute: mockSetMute } }],
      ]);
      guild.channels.cache.set('voice-1', voiceCh);
      guild.channels.fetch = jest.fn(async (id) => guild.channels.cache.get(id) || null);

      await gm._safeDeleteChannel(guild, 'voice-1');
      expect(mockSetMute).toHaveBeenCalledWith(false);
      expect(mockSetMute).toHaveBeenCalledTimes(2);

      gm.destroy();
    });

    test('returns true for error code 10003 (Unknown Channel)', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      const ch = new Channel('ch-1', 0);
      ch.guildId = 'g1';
      ch.delete = jest.fn(async () => { throw Object.assign(new Error('Unknown Channel'), { code: 10003 }); });
      ch.permissionOverwrites = new Map();
      ch.permissionOverwrites.edit = jest.fn(async () => {});
      guild.channels.cache.set('ch-1', ch);
      guild.channels.fetch = jest.fn(async (id) => guild.channels.cache.get(id) || null);

      const result = await gm._safeDeleteChannel(guild, 'ch-1');
      expect(result).toBe(true);

      gm.destroy();
    });

    test('returns false for non-recoverable error', async () => {
      const gm = new GameManager();
      const guild = createMockGuild({ id: 'g1' });
      const ch = new Channel('ch-1', 0);
      ch.guildId = 'g1';
      ch.delete = jest.fn(async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); });
      ch.permissionOverwrites = new Map();
      ch.permissionOverwrites.edit = jest.fn(async () => {});
      guild.channels.cache.set('ch-1', ch);
      guild.channels.fetch = jest.fn(async (id) => guild.channels.cache.get(id) || null);

      const result = await gm._safeDeleteChannel(guild, 'ch-1');
      expect(result).toBe(false);

      gm.destroy();
    });
  });

  // === Classic mode (subset of roles) ===

  describe('CLASSIC mode — only selected subset of roles', () => {
    test('prunes channels for roles not in classic selection', async () => {
      // Classic mode: only WEREWOLF + SEER + WITCH distributed
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.SEER }),
          createMockPlayer({ id: 'p3', role: ROLES.WITCH }),
          createMockPlayer({ id: 'p4', role: ROLES.HUNTER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result = await gm.pruneUnusedRoleChannels(guild, game);

      expect(result.kept).toEqual(expect.arrayContaining([
        'wolvesChannelId', 'seerChannelId', 'witchChannelId'
      ]));
      expect(result.pruned).toEqual(expect.arrayContaining([
        'cupidChannelId', 'salvateurChannelId', 'whiteWolfChannelId', 'thiefChannelId'
      ]));

      gm.destroy();
    });
  });

  // === Idempotency ===

  describe('idempotency', () => {
    test('calling prune twice does not crash or change state further', async () => {
      const { gm, game, guild } = createFullGame({
        players: [
          createMockPlayer({ id: 'p1', role: ROLES.WEREWOLF }),
          createMockPlayer({ id: 'p2', role: ROLES.SEER }),
          createMockPlayer({ id: 'p3', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p4', role: ROLES.VILLAGER }),
          createMockPlayer({ id: 'p5', role: ROLES.VILLAGER }),
        ],
      });

      const result1 = await gm.pruneUnusedRoleChannels(guild, game);
      expect(result1.pruned.length).toBeGreaterThan(0);

      // Second call: channels already null/gone
      const result2 = await gm.pruneUnusedRoleChannels(guild, game);
      expect(result2.pruned).toHaveLength(0);
      expect(result2.failed).toHaveLength(0);
      // kept should still be wolves + seer (their fields are non-null)
      expect(result2.kept).toContain('wolvesChannelId');
      expect(result2.kept).toContain('seerChannelId');

      gm.destroy();
    });
  });
});
