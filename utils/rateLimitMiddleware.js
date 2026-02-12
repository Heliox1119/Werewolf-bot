/**
 * Middleware de rate limiting pour les commandes Discord
 * 
 * Ajoute automatiquement la protection contre le spam à toutes les commandes
 */

const rateLimiter = require('./rateLimiter');
const { interaction: logger } = require('./logger');

/**
 * Wrapper qui ajoute le rate limiting à une commande
 * @param {Function} executeFunction - La fonction execute() originale de la commande
 * @param {string} commandName - Nom de la commande
 * @returns {Function} Fonction wrappée avec rate limiting
 */
function withRateLimit(executeFunction, commandName) {
  return async function(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Vérifier le rate limit
    const check = rateLimiter.checkLimit(userId, commandName);

    if (!check.allowed) {
      logger.warn('Rate limit rejected', {
        userId,
        username,
        commandName,
        reason: check.reason,
        retryAfter: check.retryAfter
      });

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `⏱️ **Rate Limit**\n\n${check.reason}`, flags: 64 });
      } else {
        await interaction.reply({ content: `⏱️ **Rate Limit**\n\n${check.reason}`, flags: 64 });
      }
      return;
    }

    // Exécuter la commande originale
    try {
      await executeFunction.call(this, interaction);
    } catch (error) {
      logger.error('Command execution failed', {
        commandName,
        userId,
        error: error.message
      });
      throw error;
    }
  };
}

/**
 * Applique le rate limiting à toutes les commandes d'un module
 * @param {Object} commandModule - Module de commande avec data et execute
 * @returns {Object} Module avec execute() wrappé
 */
function applyRateLimit(commandModule) {
  if (!commandModule.execute) {
    return commandModule;
  }

  const commandName = commandModule.data?.name || 'unknown';
  
  return {
    ...commandModule,
    execute: withRateLimit(commandModule.execute, commandName)
  };
}

/**
 * Vérifie si un utilisateur est banni avant d'exécuter une action
 * Utilise pour les actions non-commandes (events, etc.)
 */
async function checkUserBanned(userId, interaction = null) {
  const check = rateLimiter.checkLimit(userId, 'event-action');
  
  if (!check.allowed && interaction) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: `⏱️ ${check.reason}`, flags: 64 });
    } else {
      await interaction.reply({ content: `⏱️ ${check.reason}`, flags: 64 });
    }
    return false;
  }

  return check.allowed;
}

module.exports = {
  withRateLimit,
  applyRateLimit,
  checkUserBanned
};
