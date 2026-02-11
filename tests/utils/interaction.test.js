// Mock logger before requiring interaction module
jest.mock('../../utils/logger', () => ({
  interaction: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const { safeDefer, safeReply, safeEditReply } = require('../../utils/interaction');

describe('interaction utilities', () => {
  describe('safeDefer()', () => {
    test('defer avec succès', async () => {
      const interaction = {
        deferred: false,
        replied: false,
        deferReply: jest.fn(),
        commandName: 'test',
        channelId: 'ch-1'
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(true);
      expect(interaction.deferReply).toHaveBeenCalled();
    });

    test('retourne true si déjà deferred', async () => {
      const interaction = {
        deferred: true,
        replied: false,
        deferReply: jest.fn()
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(true);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    test('retourne true si déjà replied', async () => {
      const interaction = {
        deferred: false,
        replied: true,
        deferReply: jest.fn()
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(true);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    test('retourne false sur erreur 10062 (interaction expirée)', async () => {
      const interaction = {
        deferred: false,
        replied: false,
        deferReply: jest.fn().mockRejectedValue({ code: 10062, message: 'Unknown interaction' }),
        commandName: 'test',
        channelId: 'ch-1',
        createdTimestamp: Date.now(),
        guildId: 'g-1',
        user: { id: 'u-1' }
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(false);
    });

    test('retourne true sur InteractionAlreadyReplied', async () => {
      const interaction = {
        deferred: false,
        replied: false,
        deferReply: jest.fn().mockRejectedValue({ code: 'InteractionAlreadyReplied', message: 'Already replied' }),
        commandName: 'test'
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(true);
    });

    test('retourne false sur erreur inconnue', async () => {
      const interaction = {
        deferred: false,
        replied: false,
        deferReply: jest.fn().mockRejectedValue(new Error('network error')),
        commandName: 'test',
        channelId: 'ch-1'
      };

      const result = await safeDefer(interaction);

      expect(result).toBe(false);
    });
  });

  describe('safeReply()', () => {
    test('envoie une reply avec succès', async () => {
      const interaction = {
        reply: jest.fn().mockResolvedValue({ id: 'msg-1' }),
        commandName: 'test',
        channelId: 'ch-1',
        user: { id: 'u-1' }
      };

      const result = await safeReply(interaction, { content: 'Hello' });

      expect(result).toEqual({ id: 'msg-1' });
      expect(interaction.reply).toHaveBeenCalledWith({ content: 'Hello' });
    });

    test('tente followUp sur erreur 10062 si deferred', async () => {
      const interaction = {
        reply: jest.fn().mockRejectedValue({ code: 10062, message: 'Unknown interaction' }),
        followUp: jest.fn().mockResolvedValue({ id: 'followup-1' }),
        deferred: true,
        replied: false,
        commandName: 'test',
        channelId: 'ch-1',
        user: { id: 'u-1' }
      };

      const result = await safeReply(interaction, { content: 'Fallback' });

      expect(interaction.followUp).toHaveBeenCalledWith({ content: 'Fallback' });
      expect(result).toEqual({ id: 'followup-1' });
    });

    test('throw sur erreur non-10062', async () => {
      const err = new Error('Permission denied');
      err.code = 50013;
      const interaction = {
        reply: jest.fn().mockRejectedValue(err),
        commandName: 'test',
        channelId: 'ch-1',
        user: { id: 'u-1' }
      };

      await expect(safeReply(interaction, { content: 'test' })).rejects.toThrow('Permission denied');
    });
  });

  describe('safeEditReply()', () => {
    test('retourne false si pas deferred ni replied', async () => {
      const interaction = {
        deferred: false,
        replied: false,
        editReply: jest.fn()
      };

      const result = await safeEditReply(interaction, 'content');

      expect(result).toBe(false);
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    test('édite avec succès si deferred', async () => {
      const interaction = {
        deferred: true,
        replied: false,
        editReply: jest.fn().mockResolvedValue({ id: 'edit-1' }),
        commandName: 'test',
        channelId: 'ch-1',
        user: { id: 'u-1' }
      };

      const result = await safeEditReply(interaction, { content: 'Updated' });

      expect(result).toEqual({ id: 'edit-1' });
    });

    test('retourne false sur erreur 10062', async () => {
      const interaction = {
        deferred: true,
        replied: false,
        editReply: jest.fn().mockRejectedValue({ code: 10062, message: 'expired' }),
        commandName: 'test'
      };

      const result = await safeEditReply(interaction, 'content');

      expect(result).toBe(false);
    });

    test('retourne false sur InteractionNotReplied', async () => {
      const interaction = {
        deferred: true,
        replied: false,
        editReply: jest.fn().mockRejectedValue({ code: 'InteractionNotReplied', message: 'not replied' }),
        commandName: 'test'
      };

      const result = await safeEditReply(interaction, 'content');

      expect(result).toBe(false);
    });
  });
});
