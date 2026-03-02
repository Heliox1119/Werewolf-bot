const { MessageFlags } = require('discord.js');
const { interaction: logger, interactionMeta } = require('./logger');

module.exports = {
  async safeDefer(interaction, options = {}) {
    // Check if already deferred or replied
    if (interaction.deferred || interaction.replied) {
      logger.debug('DEFER_ALREADY_DONE');
      return true;
    }

    try {
      await interaction.deferReply(options);
      logger.debug('DEFER_OK');
      return true;
    } catch (err) {
      if (err.code === 10062) {
        // Interaction expired - cannot proceed
        logger.warn('INTERACTION_EXPIRED', { 
          ...interactionMeta(interaction),
          age: interaction.createdTimestamp ? Date.now() - interaction.createdTimestamp : -1
        });
        return false;
      }
      
      if (err.code === 'InteractionAlreadyReplied') {
        // Already replied somehow
        logger.warn('INTERACTION_ALREADY_REPLIED');
        return true;
      }
      
      // Other errors - log and return false
      logger.error('DEFER_FAILED', { 
        ...interactionMeta(interaction),
        error: err?.message || 'Unknown error',
        code: err?.code || 'NO_CODE'
      });
      return false;
    }
  },

  async safeReply(interaction, options = {}) {
    try {
      const result = await interaction.reply(options);
      if (!interaction.__logWrapped) {
        logger.info('REPLY_SENT', {
          ...interactionMeta(interaction),
          content: typeof options === 'string' ? options : options.content || '[embed/complex]'
        });
      }
      logger.debug('REPLY_OK');
      return result;
    } catch (err) {
      if (err.code === 10062) {
        // Unknown interaction — try followUp if possible, otherwise log silently
        try {
          if (interaction.deferred || interaction.replied) {
            logger.warn('INTERACTION_EXPIRED_FOLLOWUP');
            return await interaction.followUp(options);
          }
        } catch (e) {
          if (e.code !== 10062) {
            logger.error('FOLLOWUP_FALLBACK_FAILED', e);
          }
        }
      }
      logger.error('REPLY_FAILED', err);
      throw err;
    }
  },

  async safeEditReply(interaction, content) {
    if (!interaction.deferred && !interaction.replied) {
      logger.warn('EDIT_REPLY_NOT_DEFERRED');
      return false;
    }

    try {
      const result = await interaction.editReply(content);
      if (!interaction.__logWrapped) {
        logger.info('REPLY_EDITED', {
          ...interactionMeta(interaction),
          content: typeof content === 'string' ? content : content?.content || '[embed/complex]'
        });
      }
      logger.debug('EDIT_REPLY_OK');
      return result;
    } catch (err) {
      if (err.code === 10062) {
        // Interaction expired - silently ignore
        logger.warn('EDIT_REPLY_EXPIRED');
        return false;
      }

      if (err.code === 10008) {
        // Original message/channel was deleted (e.g. cleanup after game end)
        logger.warn('EDIT_REPLY_MESSAGE_DELETED');
        return false;
      }
      
      if (err.code === 'InteractionNotReplied') {
        logger.warn('EDIT_REPLY_NOT_REPLIED');
        return false;
      }
      
      // Other errors - log but don't throw
      logger.error('EDIT_REPLY_FAILED', { 
        ...interactionMeta(interaction),
        error: err?.message || 'Unknown error',
        code: err?.code || 'NO_CODE'
      });
      return false;
    }
  }
};
