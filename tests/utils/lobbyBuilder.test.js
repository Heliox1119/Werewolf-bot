/**
 * Tests for utils/lobbyBuilder — buildLobbyExpiredMessage, balance mode toggle UI.
 */
'use strict';

jest.mock('../../database/db');

const { buildLobbyExpiredMessage, buildLobbyMessage, buildRolesPreview } = require('../../utils/lobbyBuilder');
const BalanceMode = require('../../game/balanceMode');
const ROLES = require('../../game/roles');

describe('lobbyBuilder', () => {
  describe('buildLobbyExpiredMessage', () => {
    test('returns embed with grey color, no components, no files', () => {
      const game = {
        mainChannelId: 'ch-1',
        lobbyHostId: '100000000000000001',
        players: [
          { id: '100000000000000001', username: 'Alice' },
          { id: '100000000000000002', username: 'Bob' },
        ],
        rules: { minPlayers: 5, maxPlayers: 10 },
      };

      const payload = buildLobbyExpiredMessage(game);

      expect(payload.components).toEqual([]);
      expect(payload.files).toEqual([]);
      expect(payload.embeds).toHaveLength(1);

      const embed = payload.embeds[0];
      expect(embed.data.color).toBe(0x2f3136);
      // Title and description contain expired text
      expect(embed.data.title).toContain('⏳');
      expect(embed.data.description).toBeDefined();
    });

    test('shows strikethrough player names in embed', () => {
      const game = {
        mainChannelId: 'ch-2',
        lobbyHostId: '100000000000000001',
        players: [
          { id: '100000000000000001', username: 'Alice' },
          { id: '100000000000000002', username: 'Bob' },
          { id: '100000000000000003', username: 'Charlie' },
        ],
        rules: { minPlayers: 5, maxPlayers: 10 },
      };

      const payload = buildLobbyExpiredMessage(game);
      const embed = payload.embeds[0];

      // Should have a players field with strikethrough
      const playersField = embed.data.fields.find(f => f.name.includes('3'));
      expect(playersField).toBeDefined();
      expect(playersField.value).toContain('~~Alice~~');
      expect(playersField.value).toContain('~~Bob~~');
      expect(playersField.value).toContain('~~Charlie~~');
    });

    test('handles empty players list', () => {
      const game = {
        mainChannelId: 'ch-3',
        lobbyHostId: null,
        players: [],
        rules: { minPlayers: 5, maxPlayers: 10 },
      };

      const payload = buildLobbyExpiredMessage(game);
      expect(payload.components).toEqual([]);
      expect(payload.embeds).toHaveLength(1);
      // No players field when empty
      expect(payload.embeds[0].data.fields || []).toHaveLength(0);
    });

    test('handles null/undefined game gracefully', () => {
      const payload = buildLobbyExpiredMessage(null);
      expect(payload.components).toEqual([]);
      expect(payload.embeds).toHaveLength(1);
    });

    test('active lobby has buttons but expired lobby does not', () => {
      const game = {
        mainChannelId: 'ch-compare',
        lobbyHostId: '100000000000000001',
        players: [
          { id: '100000000000000001', username: 'Host' },
        ],
        rules: { minPlayers: 5, maxPlayers: 10 },
        _lobbyCreatedAt: Date.now(),
      };

      const activePayload = buildLobbyMessage(game, game.lobbyHostId);
      const expiredPayload = buildLobbyExpiredMessage(game);

      // Active lobby has button action rows
      expect(activePayload.components.length).toBeGreaterThan(0);
      // Expired lobby has zero components
      expect(expiredPayload.components).toEqual([]);
    });
  });

  // ─── Balance mode toggle button ──────────────────────────────
  describe('balance mode button in lobby', () => {
    function makeGame(balanceMode = BalanceMode.DYNAMIC, playerCount = 6) {
      const players = [];
      for (let i = 0; i < playerCount; i++) {
        players.push({ id: `p${i}`, username: `Player${i}` });
      }
      return {
        mainChannelId: 'ch-balance',
        lobbyHostId: 'p0',
        guildId: 'g1',
        players,
        rules: { minPlayers: 5, maxPlayers: 10 },
        balanceMode,
        id: 42,
        _lobbyCreatedAt: Date.now(),
      };
    }

    test('DYNAMIC lobby has balance button with Primary style', () => {
      const game = makeGame(BalanceMode.DYNAMIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);

      // Settings row is the second action row
      const settingsRow = payload.components[1];
      expect(settingsRow).toBeDefined();

      const buttons = settingsRow.components;
      const balanceBtn = buttons.find(b => b.data.custom_id.startsWith('lobby_balance:'));
      expect(balanceBtn).toBeDefined();
      expect(balanceBtn.data.style).toBe(1); // ButtonStyle.Primary = 1
      expect(balanceBtn.data.label).toContain('Dynamique');
    });

    test('CLASSIC lobby has balance button with Secondary style', () => {
      const game = makeGame(BalanceMode.CLASSIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);

      const settingsRow = payload.components[1];
      const buttons = settingsRow.components;
      const balanceBtn = buttons.find(b => b.data.custom_id.startsWith('lobby_balance:'));
      expect(balanceBtn).toBeDefined();
      expect(balanceBtn.data.style).toBe(2); // ButtonStyle.Secondary = 2
      expect(balanceBtn.data.label).toContain('Classique');
    });

    test('balance button custom_id contains channel id', () => {
      const game = makeGame();
      const payload = buildLobbyMessage(game, game.lobbyHostId);

      const settingsRow = payload.components[1];
      const balanceBtn = settingsRow.components.find(b => b.data.custom_id.startsWith('lobby_balance:'));
      expect(balanceBtn.data.custom_id).toBe('lobby_balance:ch-balance');
    });

    test('balance mode label appears in info field', () => {
      const game = makeGame(BalanceMode.CLASSIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);

      const embed = payload.embeds[0];
      const infoField = embed.data.fields.find(f => f.name.includes('Information') || f.name.includes('Informations'));
      expect(infoField).toBeDefined();
      expect(infoField.value).toContain('Classique');
    });

    test('DYNAMIC info field shows Dynamique', () => {
      const game = makeGame(BalanceMode.DYNAMIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);

      const embed = payload.embeds[0];
      const infoField = embed.data.fields.find(f => f.name.includes('Information') || f.name.includes('Informations'));
      expect(infoField.value).toContain('Dynamique');
    });

    test('DYNAMIC lobby title includes 🎭 icon', () => {
      const game = makeGame(BalanceMode.DYNAMIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);
      const embed = payload.embeds[0];
      expect(embed.data.title).toContain('🎭');
    });

    test('CLASSIC lobby title includes ⚖️ icon', () => {
      const game = makeGame(BalanceMode.CLASSIC);
      const payload = buildLobbyMessage(game, game.lobbyHostId);
      const embed = payload.embeds[0];
      expect(embed.data.title).toContain('⚖️');
    });

    test('title icon changes when balance mode toggles', () => {
      const game = makeGame(BalanceMode.DYNAMIC);
      const payloadDynamic = buildLobbyMessage(game, game.lobbyHostId);
      expect(payloadDynamic.embeds[0].data.title).toContain('🎭');
      expect(payloadDynamic.embeds[0].data.title).not.toContain('⚖️');

      game.balanceMode = BalanceMode.CLASSIC;
      const payloadClassic = buildLobbyMessage(game, game.lobbyHostId);
      expect(payloadClassic.embeds[0].data.title).toContain('⚖️');
      expect(payloadClassic.embeds[0].data.title).not.toContain('🎭');
    });
  });

  // ─── buildRolesPreview balance mode dispatch ──────────────────
  describe('buildRolesPreview', () => {
    test('DYNAMIC mode returns team-grouped preview string', () => {
      const preview = buildRolesPreview(8, BalanceMode.DYNAMIC);
      expect(typeof preview).toBe('string');
      expect(preview.length).toBeGreaterThan(0);
    });

    test('CLASSIC mode returns pool-based preview string', () => {
      const preview = buildRolesPreview(10, BalanceMode.CLASSIC, 42);
      expect(typeof preview).toBe('string');
      expect(preview.length).toBeGreaterThan(0);
    });

    test('CLASSIC preview includes wolf role', () => {
      const preview = buildRolesPreview(10, BalanceMode.CLASSIC, 0);
      // Should contain the localized wolf name
      expect(preview).toContain('Loup-Garou');
    });

    test('CLASSIC preview includes villager filler', () => {
      const preview = buildRolesPreview(10, BalanceMode.CLASSIC, 0);
      // Should contain the localized villager name
      expect(preview).toContain('Villageois');
    });

    test('defaults to DYNAMIC when no mode specified', () => {
      const preview = buildRolesPreview(8);
      // Should work without error — same as DYNAMIC
      expect(typeof preview).toBe('string');
    });
  });
});
