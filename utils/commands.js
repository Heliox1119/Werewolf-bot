// Common command helpers for the Werewolf bot
const { MessageFlags } = require('discord.js');
const { isInGameCategory } = require('./validators');
const { safeDefer, safeReply, safeEditReply } = require('./interaction');
const { commands: logger } = require('./logger');
const { t } = require('./i18n');

/**
 * Ensure interaction is properly deferred/replied before proceeding
 * Returns false if defer failed
 */
async function ensureInteractionReady(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    const success = await safeDefer(interaction);
    return success;
  }
  return true;
}

/**
 * Check category and defer interaction in one call
 * CRITICAL: Defers IMMEDIATELY to avoid interaction expiration
 * Then checks category and edits reply if needed
 * Returns false if category check fails OR defer fails
 */
async function checkCategoryAndDefer(interaction) {
  // DEFER FIRST - Must happen within 3 seconds
  const deferSuccess = await ensureInteractionReady(interaction);
  if (!deferSuccess) {
    logger.error('DEFER_FAILED', { 
      channelId: interaction.channelId,
      command: interaction.commandName 
    });
    return false;
  }
  
  // NOW check category (can take longer)
  const inCategory = await isInGameCategory(interaction);
  if (!inCategory) {
    logger.warn('CATEGORY_CHECK_FAILED', { 
      channelId: interaction.channelId,
      command: interaction.commandName 
    });
    // Use editReply since we already deferred
    try {
      await interaction.editReply({
        content: t('error.action_forbidden')
      });
    } catch (e) {
      logger.error('CATEGORY_CHECK_REPLY_FAILED', e);
    }
    return false;
  }
  
  logger.debug('CATEGORY_DEFER_OK', { 
    channelId: interaction.channelId,
    command: interaction.commandName 
  });
  return true;
}

/**
 * Delete bot messages in channel (excluding specified message)
 */
async function cleanupBotMessages(channel, clientId, excludeMessageId = null) {
  try {
    if (!channel) return 0;
    const messages = await channel.messages.fetch({ limit: 100 });
    const botMessages = messages.filter(msg => 
      msg.author.id === clientId && 
      (!excludeMessageId || msg.id !== excludeMessageId)
    );
    
    logger.debug('BOT_MESSAGES_CLEANUP_STARTED', { 
      channelId: channel.id, 
      count: botMessages.size 
    });
    
    let deleted = 0;
    for (const msg of botMessages.values()) {
      try {
        await msg.delete();
        deleted++;
      } catch (e) {
        // Message already deleted or no permissions
        logger.debug('MESSAGE_DELETE_FAILED', { messageId: msg.id });
      }
    }
    
    logger.debug('BOT_MESSAGES_CLEANED', { deleted });
    return deleted;
  } catch (error) {
    logger.error('BOT_MESSAGES_CLEANUP_FAILED', error);
    return 0;
  }
}

/**
 * Send temporary message that auto-deletes
 */
async function sendTemporaryMessage(interaction, content, deleteAfter = 2000) {
  try {
    logger.debug('TEMP_MESSAGE_SENDING', { deleteAfter });
    let reply = await safeEditReply(interaction, content);

    if (!reply) {
      const channel = interaction.channel
        || (interaction.guild ? await interaction.guild.channels.fetch(interaction.channelId).catch(() => null) : null);
      if (channel) {
        reply = await channel.send(content);
      }
    }

    if (!reply) return null;
    
    // Clean up other bot messages
    if (interaction.channel) {
      await cleanupBotMessages(
        interaction.channel,
        interaction.client.user.id,
        reply.id
      );
    }
    
    // Delete this message after delay
    if (deleteAfter > 0) {
      setTimeout(() => {
        reply.delete().then(() => {
          logger.debug('TEMP_MESSAGE_DELETED');
        }).catch(() => {
          // Already deleted or no permissions
        });
      }, deleteAfter);
    }
    
    return reply;
  } catch (error) {
    logger.error('TEMP_MESSAGE_FAILED', error);
    return null;
  }
}

module.exports = {
  ensureInteractionReady,
  checkCategoryAndDefer,
  cleanupBotMessages,
  sendTemporaryMessage
};
