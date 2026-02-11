// Validation utilities for the Werewolf bot

const ConfigManager = require('./config');
const { app: logger } = require('./logger');

/**
 * Check if a channel is in the allowed game category
 * Uses cache first to avoid API delay
 */
async function isInGameCategory(interaction) {
  try {
    const config = ConfigManager.getInstance();
    const CATEGORY_ID = config.getCategoryId();
    
    if (!CATEGORY_ID) {
      // Configuration non faite
      return false;
    }
    
    // Try cache first (instant)
    let channel = interaction.guild.channels.cache.get(interaction.channelId);
    
    // Fallback to fetch if not in cache
    if (!channel) {
      channel = await interaction.guild.channels.fetch(interaction.channelId);
    }
    
    return channel.parentId === CATEGORY_ID;
  } catch (error) {
    logger.error('Error checking category:', { error: error.message });
    return false;
  }
}

/**
 * Validate Discord snowflake ID
 */
function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{17,19}$/.test(id);
}

/**
 * Check if user is admin
 */
function isAdmin(interaction) {
  return interaction.member?.permissions?.has("ADMINISTRATOR") ?? false;
}

/**
 * Check if player is in game and alive
 */
function isPlayerInGame(game, userId) {
  if (!game) return { inGame: false, alive: false };
  const player = game.players.find(p => p.id === userId);
  return {
    inGame: !!player,
    alive: player?.alive ?? false,
    player
  };
}

/**
 * Get the configured category ID
 */
function getCategoryId() {
  const config = ConfigManager.getInstance();
  return config.getCategoryId();
}

module.exports = {
  getCategoryId,
  isInGameCategory,
  isValidSnowflake,
  isAdmin,
  isPlayerInGame
};
