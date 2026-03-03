/**
 * Tests for utils/lobbyBuilder — specifically buildLobbyExpiredMessage.
 */
'use strict';

jest.mock('../../database/db');

const { buildLobbyExpiredMessage, buildLobbyMessage } = require('../../utils/lobbyBuilder');

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
});
