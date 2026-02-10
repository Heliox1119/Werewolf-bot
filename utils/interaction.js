const { MessageFlags } = require('discord.js');
const { interaction: logger } = require('./logger');

module.exports = {
  async safeDefer(interaction, options = {}) {
    // Check if already deferred or replied
    if (interaction.deferred || interaction.replied) {
      logger.debug('Interaction already deferred/replied');
      return true;
    }

    try {
      await interaction.deferReply(options);
      logger.debug('Interaction deferred successfully');
      return true;
    } catch (err) {
      if (err.code === 10062) {
        // Interaction expired - cannot proceed
        logger.error('Interaction expired (10062)', { 
          commandName: interaction.commandName || 'unknown',
          channelId: interaction.channelId || 'unknown',
          createdTimestamp: interaction.createdTimestamp || 0,
          age: interaction.createdTimestamp ? Date.now() - interaction.createdTimestamp : -1,
          guildId: interaction.guildId || 'unknown',
          userId: interaction.user?.id || 'unknown'
        });
        return false;
      }
      
      if (err.code === 'InteractionAlreadyReplied') {
        // Already replied somehow
        logger.warn('Interaction already replied');
        return true;
      }
      
      // Other errors - log and return false
      logger.error('Failed to defer interaction', { 
        error: err?.message || 'Unknown error',
        code: err?.code || 'NO_CODE',
        commandName: interaction.commandName || 'unknown',
        stack: err?.stack?.split('\n').slice(0, 3).join('\n') || 'No stack'
      });
      return false;
    }
  },

  async safeReply(interaction, options = {}) {
    try {
      const result = await interaction.reply(options);
      if (!interaction.__logWrapped) {
        logger.info('Reply sent', {
          command: interaction.commandName || 'unknown',
          channelId: interaction.channelId || 'unknown',
          userId: interaction.user?.id || 'unknown',
          content: typeof options === 'string' ? options : options.content || '[embed/complex]'
        });
      }
      logger.debug('Interaction reply sent');
      return result;
    } catch (err) {
      if (err.code === 10062) {
        // Unknown interaction — try followUp if possible, otherwise log silently
        try {
          if (interaction.deferred || interaction.replied) {
            logger.warn('Interaction expired, trying followUp');
            return await interaction.followUp(options);
          }
        } catch (e) {
          if (e.code !== 10062) {
            logger.error('followUp failed', e);
          }
        }
      }
      logger.error('Failed to reply to interaction', err);
      throw err;
    }
  },

  async safeEditReply(interaction, content) {
    if (!interaction.deferred && !interaction.replied) {
      logger.warn('Cannot editReply - interaction not deferred or replied');
      return false;
    }

    try {
      const result = await interaction.editReply(content);
      if (!interaction.__logWrapped) {
        logger.info('Reply edited', {
          command: interaction.commandName || 'unknown',
          channelId: interaction.channelId || 'unknown',
          userId: interaction.user?.id || 'unknown',
          content: typeof content === 'string' ? content : content?.content || '[embed/complex]'
        });
      }
      logger.debug('Interaction editReply sent');
      return result;
    } catch (err) {
      if (err.code === 10062) {
        // Interaction expired - silently ignore
        logger.warn('editReply failed - interaction expired (10062)');
        return false;
      }
      
      if (err.code === 'InteractionNotReplied') {
        logger.warn('editReply failed - interaction not replied yet');
        return false;
      }
      
      // Other errors - log but don't throw
      logger.error('Failed to editReply', { 
        error: err?.message || 'Unknown error',
        code: err?.code || 'NO_CODE'
      });
      return false;
    }
  }
};
