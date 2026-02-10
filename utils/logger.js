// Centralized logging system for Werewolf bot
const chalk = require('chalk');

// Log levels
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4
};

// Current log level (can be configured via environment)
const CURRENT_LEVEL = process.env.LOG_LEVEL 
  ? LogLevel[process.env.LOG_LEVEL.toUpperCase()] ?? LogLevel.INFO
  : LogLevel.INFO;

// Timestamp formatter
function getTimestamp() {
  const now = new Date();
  return now.toISOString();
}

// Format log message with context
function formatMessage(level, module, message, data = null) {
  const timestamp = getTimestamp();
  let formatted = `[${timestamp}] [${level}] [${module}] ${message}`;
  
  if (data !== null && data !== undefined) {
    if (typeof data === 'object') {
      try {
        formatted += '\n' + JSON.stringify(data, null, 2);
      } catch (e) {
        formatted += '\n' + String(data);
      }
    } else {
      formatted += ' ' + String(data);
    }
  }
  
  return formatted;
}

// Color functions
const colors = {
  debug: chalk.gray,
  info: chalk.blue,
  success: chalk.green,
  warn: chalk.yellow,
  error: chalk.red,
  critical: chalk.bgRed.white.bold
};

class Logger {
  constructor(module = 'APP') {
    this.module = module;
  }

  debug(message, data = null) {
    if (CURRENT_LEVEL <= LogLevel.DEBUG) {
      const formatted = formatMessage('DEBUG', this.module, message, data);
      console.log(colors.debug(formatted));
    }
  }

  info(message, data = null) {
    if (CURRENT_LEVEL <= LogLevel.INFO) {
      const formatted = formatMessage('INFO', this.module, message, data);
      console.log(colors.info(formatted));
    }
  }

  success(message, data = null) {
    if (CURRENT_LEVEL <= LogLevel.INFO) {
      const formatted = formatMessage('SUCCESS', this.module, message, data);
      console.log(colors.success(formatted));
    }
  }

  warn(message, data = null) {
    if (CURRENT_LEVEL <= LogLevel.WARN) {
      const formatted = formatMessage('WARN', this.module, message, data);
      console.warn(colors.warn(formatted));
    }
  }

  error(message, error = null) {
    if (CURRENT_LEVEL <= LogLevel.ERROR) {
      const data = error ? {
        message: error.message,
        code: error.code,
        stack: error.stack
      } : null;
      const formatted = formatMessage('ERROR', this.module, message, data);
      console.error(colors.error(formatted));
    }
  }

  critical(message, error = null) {
    if (CURRENT_LEVEL <= LogLevel.ERROR) {
      const data = error ? {
        message: error.message,
        code: error.code,
        stack: error.stack
      } : null;
      const formatted = formatMessage('CRITICAL', this.module, message, data);
      console.error(colors.critical(formatted));
    }
  }

  // Log interaction details
  logInteraction(interaction, action) {
    if (CURRENT_LEVEL <= LogLevel.DEBUG) {
      const data = {
        user: `${interaction.user.username} (${interaction.user.id})`,
        channel: interaction.channelId,
        guild: interaction.guildId,
        command: interaction.commandName || 'button',
        customId: interaction.customId || 'N/A',
        action: action
      };
      this.debug('Interaction received', data);
    }
  }

  // Log game state changes
  logGameState(channelId, phase, subPhase, playerCount) {
    if (CURRENT_LEVEL <= LogLevel.INFO) {
      const data = {
        channelId,
        phase,
        subPhase,
        players: playerCount
      };
      this.info('Game state updated', data);
    }
  }

  // Log voice activity
  logVoice(action, channelId, details = null) {
    if (CURRENT_LEVEL <= LogLevel.DEBUG) {
      const data = {
        action,
        channelId,
        ...details
      };
      this.debug('Voice activity', data);
    }
  }

  // Log API calls
  logAPI(method, endpoint, status = null, duration = null) {
    if (CURRENT_LEVEL <= LogLevel.DEBUG) {
      const data = {
        method,
        endpoint,
        status,
        duration: duration ? `${duration}ms` : 'N/A'
      };
      this.debug('API call', data);
    }
  }

  // Performance tracking
  startTimer(label) {
    const start = Date.now();
    return {
      end: () => {
        const duration = Date.now() - start;
        this.debug(`Timer [${label}]`, { duration: `${duration}ms` });
        return duration;
      }
    };
  }
}

// Create default loggers for different modules
const loggers = {
  app: new Logger('APP'),
  game: new Logger('GAME'),
  commands: new Logger('COMMANDS'),
  voice: new Logger('VOICE'),
  interaction: new Logger('INTERACTION'),
  discord: new Logger('DISCORD')
};

// Factory function
function createLogger(module) {
  return new Logger(module);
}

module.exports = {
  Logger,
  createLogger,
  LogLevel,
  ...loggers
};
