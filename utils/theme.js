/**
 * Centralized theme system for embed colors.
 * Provides semantic color names and multiple predefined palettes.
 */

const THEMES = {
  classic: {
    name: 'Classic',
    emoji: '🐺',
    colors: {
      primary:  0xFF6B6B,  // Coral red — brand / role DM
      success:  0x2ECC71,  // Green
      error:    0xE74C3C,  // Red
      warning:  0xF39C12,  // Orange
      info:     0x3498DB,  // Blue
      accent:   0x4ECDC4,  // Teal
      muted:    0x95A5A6,  // Grey
      special:  0xFFD166,  // Gold — game summary
      blurple:  0x5865F2,  // Discord blurple — stats
      purple:   0x9B59B6,  // Purple — history
      critical: 0x992D22,  // Dark red — critical alerts
      roleSelect: 0x00AE86, // Teal green — role selection
    }
  },
  midnight: {
    name: 'Midnight',
    emoji: '🌙',
    colors: {
      primary:  0x7289DA,
      success:  0x43B581,
      error:    0xF04747,
      warning:  0xFAA61A,
      info:     0x4F545C,
      accent:   0x7289DA,
      muted:    0x72767D,
      special:  0xFAA61A,
      blurple:  0x5865F2,
      purple:   0x8B5CF6,
      critical: 0xED4245,
      roleSelect: 0x43B581,
    }
  },
  nature: {
    name: 'Nature',
    emoji: '🌿',
    colors: {
      primary:  0x6DBE45,
      success:  0x4CAF50,
      error:    0xD32F2F,
      warning:  0xFFA726,
      info:     0x29B6F6,
      accent:   0x8BC34A,
      muted:    0x9E9E9E,
      special:  0xFFD54F,
      blurple:  0x5865F2,
      purple:   0xAB47BC,
      critical: 0xB71C1C,
      roleSelect: 0x66BB6A,
    }
  },
  blood: {
    name: 'Blood Moon',
    emoji: '🩸',
    colors: {
      primary:  0xB71C1C,
      success:  0x8BC34A,
      error:    0xFF1744,
      warning:  0xFF6D00,
      info:     0x546E7A,
      accent:   0xD50000,
      muted:    0x616161,
      special:  0xFFAB00,
      blurple:  0x5865F2,
      purple:   0x880E4F,
      critical: 0x4A0000,
      roleSelect: 0xE53935,
    }
  },
};

// Per-guild theme selection (guildId → theme key)
const guildThemes = new Map();

/**
 * Set a guild's theme.
 * @param {string} guildId
 * @param {string} themeKey - One of: classic, midnight, nature, blood
 * @returns {boolean} true if the theme exists
 */
function setTheme(guildId, themeKey) {
  if (!THEMES[themeKey]) return false;
  guildThemes.set(guildId, themeKey);
  return true;
}

/**
 * Get the current theme key for a guild.
 * @param {string} guildId
 * @returns {string}
 */
function getThemeKey(guildId) {
  return guildThemes.get(guildId) || 'classic';
}

/**
 * Get a semantic color value for a guild.
 * @param {string} guildId
 * @param {string} colorName - One of: primary, success, error, warning, info, accent, muted, special, blurple, purple, critical, roleSelect
 * @returns {number} The hex color value
 */
function getColor(guildId, colorName) {
  const key = guildThemes.get(guildId) || 'classic';
  const theme = THEMES[key];
  return theme.colors[colorName] ?? THEMES.classic.colors[colorName] ?? 0x5865F2;
}

/**
 * Get health status color (for monitoring).
 * Maps HEALTHY/DEGRADED/UNHEALTHY to success/warning/error.
 * @param {string} guildId
 * @param {string} status
 * @returns {number}
 */
function getHealthColor(guildId, status) {
  const map = { HEALTHY: 'success', DEGRADED: 'warning', UNHEALTHY: 'error' };
  return getColor(guildId, map[status] || 'info');
}

/**
 * Get alert severity color.
 * @param {string} guildId
 * @param {string} severity
 * @returns {number}
 */
function getSeverityColor(guildId, severity) {
  const map = { info: 'info', warning: 'warning', error: 'error', critical: 'critical' };
  return getColor(guildId, map[severity] || 'info');
}

/**
 * Get lobby color based on fill percentage.
 * @param {string} guildId
 * @param {number} ratio - 0 to 1
 * @returns {number}
 */
function getLobbyColor(guildId, ratio) {
  if (ratio >= 1) return getColor(guildId, 'success');
  if (ratio >= 0.75) return getColor(guildId, 'info');
  if (ratio >= 0.5) return getColor(guildId, 'warning');
  return getColor(guildId, 'muted');
}

/**
 * List all available themes.
 * @returns {Array<{key: string, name: string, emoji: string}>}
 */
function listThemes() {
  return Object.entries(THEMES).map(([key, theme]) => ({
    key,
    name: theme.name,
    emoji: theme.emoji,
  }));
}

module.exports = {
  THEMES,
  setTheme,
  getThemeKey,
  getColor,
  getHealthColor,
  getSeverityColor,
  getLobbyColor,
  listThemes,
};
