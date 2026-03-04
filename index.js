require("dotenv").config();

const { Client, GatewayIntentBits, Collection, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const gameManager = require("./game/gameManager");
const { app: logger, interaction: interactionLogger, interactionMeta, runWithContext, rid } = require("./utils/logger");
const { safeEditReply } = require("./utils/interaction");
const { t } = require('./utils/i18n');
const WebServer = require('./web/server');
const startupLock = require('./utils/startupLock');

// Web server (initialized on bot ready)
let webServer = null;

// Validation des variables d'environnement requises
// NOTE: Ce bot supporte le multi-serveur avec config & langue par guild.
// Les commandes sont enregistrées globalement si GUILD_ID est absent.
// GUILD_ID est optionnel — s'il est défini, les commandes sont aussi enregistrées en guild (instant).
const REQUIRED_ENV = ['TOKEN', 'CLIENT_ID'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.fatal('ENV_MISSING', { key });
    process.exit(1);
  }
}

// Inter-process startup lock (split-brain protection)
const lockResult = startupLock.acquire();
if (!lockResult.ok) {
  logger.fatal('STARTUP_LOCK_FAILED', {
    reason: lockResult.reason,
    ownerPid: lockResult.ownerPid,
    ownerStartedAt: lockResult.ownerStartedAt,
    lockFilePath: lockResult.lockFilePath,
    error: lockResult.error ? lockResult.error.message : undefined
  });
  process.exit(1);
}
logger.info('STARTUP_LOCK_ACQUIRED', {
  pid: lockResult.pid,
  lockFilePath: lockResult.lockFilePath
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Expose le client pour accès global (auto-cleanup)
require.main.exports = require.main.exports || {};
require.main.exports.client = client;

client.commands = new Collection();

// Charger le middleware de rate limiting
const { applyRateLimit } = require("./utils/rateLimitMiddleware");

// Charger le système de monitoring
const MetricsCollector = require("./monitoring/metrics");
const AlertSystem = require("./monitoring/alerts");
const BackupManager = require("./database/backup");

// Charger les commandes avec rate limiting automatique
const commandFiles = fs.readdirSync("./commands").filter(file => file.endsWith(".js"));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  // Appliquer le rate limiting automatiquement
  const protectedCommand = applyRateLimit(command);
  client.commands.set(protectedCommand.data.name, protectedCommand);
  logger.debug('COMMAND_LOADED', { name: command.data.name });
}

// Bot prêt
client.once("clientReady", async () => {
  logger.info('BOT_READY', { tag: client.user.tag });
  logger.info('REGISTERING_COMMANDS');

  // Initialiser le système de configuration
  try {
    const ConfigManager = require('./utils/config');
    const GameDatabase = require('./database/db');
    const db = new GameDatabase();
    ConfigManager.initialize(db.db); // Passer l'objet SQLite directement
    
    const config = ConfigManager.getInstance();
    logger.info('CONFIG_INITIALIZED');

    // Initialiser le système i18n
    const i18n = require('./utils/i18n');
    i18n.initialize(db.db);
    
    // Vérifier si le setup est complet
    if (!config.isSetupComplete()) {
      logger.warn('SETUP_INCOMPLETE');
      const missing = config.getMissingSetupKeys();
      logger.warn('SETUP_MISSING_KEYS', { keys: missing.map(m => m.key) });
    } else {
      logger.info('SETUP_COMPLETE');
    }
  } catch (error) {
    logger.error('CONFIG_INIT_FAILED', { error: error.message });
  }

  // Initialiser le système de monitoring
  try {
    const ConfigManager = require('./utils/config');
    const config = ConfigManager.getInstance();
    
    // Utiliser le webhook de la configuration ou .env
    const webhookUrl = config.getMonitoringWebhookUrl() || process.env.MONITORING_WEBHOOK_URL;
    
    MetricsCollector.initialize(client);
    AlertSystem.initialize(webhookUrl);
    
    const metrics = MetricsCollector.getInstance();
    const alerts = AlertSystem.getInstance();
    
    // Démarrer la collecte automatique avec intervalle configuré
    const metricsInterval = config.getMetricsInterval();
    metrics.startCollection(metricsInterval);
    
    // Activer/désactiver les alertes selon la config
    alerts.setEnabled(config.isMonitoringAlertsEnabled());
    
    logger.info('MONITORING_INITIALIZED', { 
      interval: `${metricsInterval / 1000}s`,
      alertsEnabled: config.isMonitoringAlertsEnabled()
    });
    
    // Envoyer une alerte de démarrage si webhook configuré
    if (webhookUrl) {
      const packageJson = require('./package.json');
      await alerts.alertBotStarted(packageJson.version, 'N/A');
    }
  } catch (error) {
    logger.error('MONITORING_INIT_FAILED', { error: error.message });
  }

  // Initialiser le système de backup automatique
  try {
    const GameDatabase = require('./database/db');
    const backupDb = new GameDatabase();
    BackupManager.initialize(backupDb);
    const backup = BackupManager.getInstance();
    backup.startAutoBackup();
    logger.info('BACKUP_INITIALIZED');
  } catch (error) {
    logger.error('BACKUP_INIT_FAILED', { error: error.message });
  }

  // Initialiser le système d'achievements & ELO
  try {
    gameManager.initAchievements();
  } catch (error) {
    logger.error('ACHIEVEMENTS_INIT_FAILED', { error: error.message });
  }

  // Initialiser le Web Dashboard & API
  try {
    const GameDatabase = require('./database/db');
    const webDb = new GameDatabase();
    webServer = new WebServer({
      port: parseInt(process.env.WEB_PORT) || 3000,
      gameManager,
      db: webDb,
      client
    });
    await webServer.start();
  } catch (error) {
    logger.error('WEB_INIT_FAILED', { error: error.message, stack: error.stack });
  }

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);
  const commandsJson = client.commands.map(cmd => cmd.data.toJSON());

  try {
    // Si GUILD_ID défini, enregistrer en guild uniquement (instantané, pas de doublons)
    if (process.env.GUILD_ID) {
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commandsJson }
      );
      logger.info('COMMANDS_REGISTERED', { mode: 'guild', guildId: process.env.GUILD_ID, count: client.commands.size });
    } else {
      // Pas de GUILD_ID → enregistrement global (propagation ~1h pour les nouveaux serveurs)
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandsJson }
      );
      logger.info('COMMANDS_REGISTERED', { mode: 'global', count: client.commands.size });
    }

    // Auto-enregistrer les commandes quand le bot rejoint un nouveau serveur
    client.on('guildCreate', async (guild) => {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
          { body: commandsJson }
        );
        logger.info('COMMANDS_REGISTERED', { mode: 'guild_join', guildId: guild.id, guildName: guild.name });
      } catch (err) {
        logger.error('COMMANDS_REGISTER_FAILED', { guildId: guild.id, error: err.message });
      }
    });

      // ─── Permission check (all guilds) ────────────────────────────
      const REQUIRED_PERMS = [
        'ManageChannels', 'ManageRoles', 'MuteMembers',
        'SendMessages', 'EmbedLinks', 'Connect', 'Speak',
        'ViewChannel', 'ReadMessageHistory'
      ];

      for (const [guildId, guild] of client.guilds.cache) {
        try {
          const botMember = guild.members.me || await guild.members.fetchMe();
          const missing = REQUIRED_PERMS.filter(p => !botMember.permissions.has(p));
          if (missing.length > 0) {
            logger.warn('PERMISSIONS_MISSING', { guildId, guildName: guild.name, missing });
          } else {
            logger.info('PERMISSIONS_OK', { guildId, guildName: guild.name });
          }
        } catch (err) {
          logger.error('PERMISSIONS_CHECK_FAILED', err);
        }
      }
      // ──────────────────────────────────────────────────────────────

      // Load saved game state BEFORE orphan cleanup so channels are recognized
      try {
        logger.info('GAME_STATE_LOADING');
        gameManager.loadState();
        logger.info('GAME_STATE_LOADED', { count: gameManager.games.size });
      } catch (err) {
        logger.error('GAME_STATE_LOAD_FAILED', err);
      }

      // ─── Guild reconciliation: purge data for guilds bot left ─────
      try {
        const { reconcileGuildsOnStartup } = require('./game/guildReconciler');
        const result = reconcileGuildsOnStartup(client, gameManager.db, gameManager);
        if (result.removed.length > 0) {
          logger.info('GUILD_RECONCILIATION_DONE', { removed: result.removed.length, kept: result.kept.length });
        }
      } catch (err) {
        logger.error('GUILD_RECONCILIATION_FAILED', { error: err.message });
      }
      // ──────────────────────────────────────────────────────────────

      // ─── Orphan channel cleanup (100% DB-based) ────────────────
      try {
        logger.info('ORPHAN_CLEANUP_STARTED');
        // Clean orphan DB-registered channels that no longer belong to an active game.
        // Also purge DB records whose guild is no longer accessible.
        const staleGuildIds = new Set();
        for (const rc of gameManager.db.getAllRegisteredChannels()) {
          if (!client.guilds.cache.has(rc.guild_id)) {
            staleGuildIds.add(rc.guild_id);
            gameManager.db.deleteGameChannel(rc.channel_id);
          }
        }
        if (staleGuildIds.size > 0) {
          logger.info('ORPHAN_STALE_GUILDS_CLEANED', { count: staleGuildIds.size });
        }
        // For each accessible guild, delegate to the unified DB-based method
        for (const [, guild] of client.guilds.cache) {
          try {
            const deleted = await gameManager.cleanupOrphanChannels(guild);
            if (deleted > 0) {
              logger.info('ORPHAN_GUILD_CLEANUP_DONE', { guild: guild.name, deleted });
            }
          } catch (e) {
            logger.error('ORPHAN_GUILD_CLEANUP_FAILED', { guild: guild.name, error: e.message });
          }
        }
      } catch (err) {
        logger.error('ORPHAN_CLEANUP_FAILED', err);
      }
      // ──────────────────────────────────────────────────────────────

      // Restaurer les parties chargées et tenter une restauration minimale
      try {
        logger.info('GAME_RESTORE_STARTED', { count: gameManager.games.size });
        for (const [channelId, game] of gameManager.games.entries()) {
          // Résoudre le guild de cette partie
          const guild = game.guildId 
            ? (client.guilds.cache.get(game.guildId) || await client.guilds.fetch(game.guildId).catch(() => null))
            : null;

          if (!guild) {
            logger.warn('GAME_RESTORE_UNKNOWN_GUILD', { channelId, guildId: game.guildId });
            gameManager.purgeGame(channelId, game);
            continue;
          }

          // Validate main channel still exists
          const mainChannel = await guild.channels.fetch(game.mainChannelId).catch(() => null);
          if (!mainChannel) {
            logger.warn('GAME_RESTORE_MISSING_CHANNEL', { channelId, mainChannelId: game.mainChannelId });
            gameManager.purgeGame(channelId, game);
            continue;
          }

          // Reconnect voice only if voice channel exists
          if (game.voiceChannelId) {
            const voiceChannel = await guild.channels.fetch(game.voiceChannelId).catch(() => null);
            if (voiceChannel) {
              gameManager.joinVoiceChannel(guild, game.voiceChannelId)
                .then(() => logger.debug('VOICE_RECONNECTED', { channelId, voiceChannelId: game.voiceChannelId }))
                .catch(e => logger.error('VOICE_RESTORE_FAILED', e));
            } else {
              logger.warn('GAME_RESTORE_MISSING_VOICE', { channelId, voiceChannelId: game.voiceChannelId });
              game.voiceChannelId = null;
              gameManager.saveState();
            }
          }

          // Rafraîchir le lobby embed si présent
          try { await updateLobbyEmbed(guild, channelId); } catch (e) { /* ignore */ }

          // Re-arm timers: lobby timeout for games not yet started
          if (!game.startedAt) {
            gameManager.setLobbyTimeout(channelId);
            logger.debug('TIMER_LOBBY_REARMED', { channelId });
          } else {
            // Re-arm gameplay timers for in-progress games
            const PHASES = require('./game/phases');
            const nightActionPhases = [PHASES.VOLEUR, PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.SALVATEUR, PHASES.CUPIDON];
            if (game.phase === PHASES.NIGHT && nightActionPhases.includes(game.subPhase)) {
              gameManager.startNightAfkTimeout(guild, game);
              logger.debug('TIMER_NIGHT_AFK_REARMED', { channelId, subPhase: game.subPhase });
            } else if (game.phase === PHASES.NIGHT && game.subPhase === PHASES.REVEIL) {
              // Was about to transition to day — do it now
              gameManager.transitionToDay(guild, game).catch(e => logger.error('RESTORE_TRANSITION_FAILED', { error: e.message }));
              logger.debug('RESTORE_DAY_TRANSITION', { channelId });
            } else if (game.phase === PHASES.DAY) {
              if (game.subPhase === PHASES.VOTE) {
                gameManager.startDayTimeout(guild, game);
                logger.debug('TIMER_VOTE_REARMED', { channelId });
              } else if (game.subPhase === PHASES.VOTE_CAPITAINE) {
                gameManager.startCaptainVoteTimeout(guild, game);
                logger.debug('TIMER_CAPTAIN_VOTE_REARMED', { channelId });
              }
            }

            // Re-arm hunter shoot timeout if hunter was waiting to shoot
            if (game._hunterMustShoot) {
              gameManager.startHunterTimeout(guild, game, game._hunterMustShoot);
              logger.debug('TIMER_HUNTER_REARMED', { channelId, hunterId: game._hunterMustShoot });
            }

            // Re-arm captain tiebreak timeout if tiebreak was in progress
            if (game._captainTiebreak && Array.isArray(game._captainTiebreak) && game._captainTiebreak.length > 0) {
              gameManager.startCaptainTiebreakTimeout(guild, game);
              logger.debug('TIMER_CAPTAIN_TIEBREAK_REARMED', { channelId, tiedIds: game._captainTiebreak });
            }
          }
        }
      } catch (err) {
        logger.error('GAME_RESTORATION_FAILED', err);
      }

      // Archive old completed games (cleanup DB)
      try {
        const archived = gameManager.db.archiveOldGames(7);
        if (archived > 0) logger.info('GAMES_ARCHIVED', { count: archived });
      } catch (err) {
        logger.error('GAMES_ARCHIVE_FAILED', err);
      }
  } catch (error) {
    logger.error('COMMANDS_REGISTER_FAILED', error);
  }
});

// Fonction pour rafraîchir l'embed du lobby
async function updateLobbyEmbed(guild, channelId) {
  try {
    const game = gameManager.games.get(channelId);
    if (!game || !game.lobbyMessageId) return;

    const channel = await guild.channels.fetch(channelId);
    const lobbyMsg = await channel.messages.fetch(game.lobbyMessageId);

    const { buildLobbyMessage } = require('./utils/lobbyBuilder');
    const payload = buildLobbyMessage(game, game.lobbyHostId);
    await lobbyMsg.edit(payload);
  } catch (err) {
    logger.error('LOBBY_REFRESH_FAILED', { message: err.message });
  }
}

// Interactions

// Auto-mute/unmute selon la phase quand un joueur rejoint/quitte le vocal
client.on('voiceStateUpdate', async (oldState, newState) => {
  try {
    // On ne gère que les connexions à un channel vocal
    if (!newState.channelId && !oldState.channelId) return;

    // Chercher la partie correspondant à ce channel
    const game = Array.from(gameManager.games.values()).find(g => g.voiceChannelId === (newState.channelId || oldState.channelId));
    if (!game) return;
    
    // Désactivation debug
    if (game.disableVoiceMute) return;
    
    // Ne pas mute/unmute si la partie est terminée
    const PHASES = require('./game/phases');
    if (game.phase === PHASES.ENDED) {
      // Unmute everyone in the voice channel if the game is ended
      const guild = newState.guild;
      const voiceChannel = guild.channels.cache.get(game.voiceChannelId) || await guild.channels.fetch(game.voiceChannelId).catch(() => null);
      if (!voiceChannel) return;
      
      for (const member of voiceChannel.members.values()) {
        if (member.user.bot) continue;
        try { await member.voice.setMute(false); } catch (e) { /* ignore */ }
      }
      return;
    }

    // Récupérer le guild et le channel (use cache first for performance)
    const guild = newState.guild;
    const voiceChannel = guild.channels.cache.get(game.voiceChannelId) || await guild.channels.fetch(game.voiceChannelId).catch(() => null);
    if (!voiceChannel) return;

    // Vérifier que le bot a la permission MUTE_MEMBERS
    const botMember = guild.members.me;
    if (botMember && !botMember.permissions.has('MuteMembers')) {
      logger.warn('BOT_MISSING_MUTE_PERMISSION');
      return;
    }

    // Pour chaque membre du channel, appliquer le mute/unmute selon la phase
    for (const member of voiceChannel.members.values()) {
      if (member.user.bot) continue;
      const player = game.players.find(p => p.id === member.id);
      if (!player || !player.alive) continue;
      
      try {
        if (game.phase === PHASES.NIGHT) {
          if (!member.voice.serverMute) {
            await member.voice.setMute(true);
          }
        } else if (game.phase === PHASES.DAY) {
          if (member.voice.serverMute) {
            await member.voice.setMute(false);
          }
        }
      } catch (e) { /* ignore */ }
    }
  } catch (err) {
    logger.error('VOICE_STATE_UPDATE_FAILED', { error: err.message });
  }
});

client.on("interactionCreate", async interaction => {
  // Ignorer les interactions en DM (toutes les commandes nécessitent un serveur)
  if (!interaction.guild) {
    try { await interaction.reply({ content: t('error.bot_only_in_server'), ephemeral: true }); } catch (e) { /* ignore */ }
    return;
  }

  // ── Async context: every log inside this handler inherits requestId + guild ──
  await runWithContext({ requestId: rid(), guildId: interaction.guildId, channelId: interaction.channelId, userId: interaction.user?.id }, async () => {

  if (!interaction.__logWrapped) {
    interaction.__logWrapped = true;

    const formatContent = (payload) => {
      if (typeof payload === 'string') return payload;
      if (payload && typeof payload === 'object') {
        return payload.content || '[embed/complex]';
      }
      return '[unknown]';
    };

    const originalReply = interaction.reply?.bind(interaction);
    if (originalReply) {
      interaction.reply = async (payload) => {
        try {
          const result = await originalReply(payload);
          interactionLogger.info('REPLY_SENT', {
            ...interactionMeta(interaction),
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('REPLY_FAILED', { ...interactionMeta(interaction), error: err.message, code: err.code });
          throw err;
        }
      };
    }

    const originalEditReply = interaction.editReply?.bind(interaction);
    if (originalEditReply) {
      interaction.editReply = async (payload) => {
        try {
          const result = await originalEditReply(payload);
          interactionLogger.info('REPLY_EDITED', {
            ...interactionMeta(interaction),
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('EDIT_REPLY_FAILED', { ...interactionMeta(interaction), error: err.message, code: err.code });
          throw err;
        }
      };
    }

    const originalFollowUp = interaction.followUp?.bind(interaction);
    if (originalFollowUp) {
      interaction.followUp = async (payload) => {
        try {
          const result = await originalFollowUp(payload);
          interactionLogger.info('FOLLOWUP_SENT', {
            ...interactionMeta(interaction),
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('FOLLOWUP_FAILED', { ...interactionMeta(interaction), error: err.message, code: err.code });
          throw err;
        }
      };
    }

    // Handle slash commands
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      const startTime = Date.now();
      let commandSuccess = true;

      try {
        logger.info('COMMAND_RECEIVED', {
          command: interaction.commandName,
          user: interaction.user?.username,
          userId: interaction.user?.id,
          channelId: interaction.channelId,
          guildId: interaction.guildId
        });
        await command.execute(interaction);
      } catch (err) {
        commandSuccess = false;
        logger.error('COMMAND_EXEC_FAILED', err);
        
        // Enregistrer l'erreur dans le monitoring
        try {
          const MetricsCollector = require('./monitoring/metrics');
          const metrics = MetricsCollector.getInstance();
          metrics.recordError('error');
        } catch {}
        
        try {
          await interaction.reply({ content: t('error.internal'), flags: MessageFlags.Ephemeral });
        } catch (e) {
          // Interaction déjà traitée
        }
      } finally {
        // Enregistrer les métriques de la commande
        try {
          const responseTime = Date.now() - startTime;
          const MetricsCollector = require('./monitoring/metrics');
          const metrics = MetricsCollector.getInstance();
          metrics.recordCommand(interaction.commandName, responseTime, commandSuccess);
        } catch {}
      }
      return;
    }

  // Gérer les boutons du lobby et des rôles
  if (interaction.isButton()) {
    const { safeDefer } = require('./utils/interaction');

    // ── Ephemeral role action buttons (no private channel) ──
    const { EPHEMERAL_BUTTON_IDS, handleEphemeralRoleButton } = require('./interactions/ephemeralRoleActions');
    if (EPHEMERAL_BUTTON_IDS.includes(interaction.customId)) {
      try {
        const deferred = await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
      } catch (err) {
        if (err.code === 10062) return;
        throw err;
      }
      await handleEphemeralRoleButton(interaction);
      return;
    }

    // ── Role action buttons (ephemeral defer) ──
    const ROLE_BTN_PREFIXES = ['thief_', 'witch_', 'seer_', 'salvateur_', 'cupid_', 'ww_'];
    if (ROLE_BTN_PREFIXES.some(p => interaction.customId.startsWith(p))) {
      try {
        const deferred = await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return; // interaction expired
      } catch (err) {
        if (err.code === 10062) return;
        throw err;
      }
      if (interaction.customId.startsWith('thief_')) {
        const { handleThiefButton } = require('./interactions/thiefButtons');
        await handleThiefButton(interaction);
      } else {
        const { handleNightButton } = require('./interactions/nightActions');
        await handleNightButton(interaction);
      }
      return;
    }

    // ── Other buttons (non-ephemeral defer) ──
    try {
      await safeDefer(interaction);
    } catch (err) {
      if (err.code === 10062) {
        // Interaction expirée (bouton trop vieux)
        return;
      }
      throw err;
    }

    const [buttonType, arg1, arg2] = interaction.customId.split(":");
    let channelId = null;
    if (buttonType === "lobby_join" || buttonType === "lobby_leave" || buttonType === "lobby_start" || buttonType === "lobby_wolfwin") {
      channelId = arg1;
    }

    if (buttonType === "game_restart" || buttonType === "game_cleanup" || buttonType === "game_rematch") {
      const targetChannelId = arg1;
      const game = gameManager.getGameByChannelId(targetChannelId);

      const isAdmin = interaction.member.permissions.has('Administrator');
      const isHost = game && game.lobbyHostId === interaction.user.id;
      if (!isAdmin && !isHost) {
        await safeEditReply(interaction, { content: t('error.admin_or_host_required'), flags: MessageFlags.Ephemeral });
        return;
      }

      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_to_cleanup'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Get category ID from configuration (guild-scoped)
      const ConfigManager = require('./utils/config');
      const config = ConfigManager.getInstance();
      const CATEGORY_ID = config.getCategoryId(interaction.guildId);
      
      if (!CATEGORY_ID) {
        await safeEditReply(interaction, { content: t('error.bot_not_configured'), flags: MessageFlags.Ephemeral });
        return;
      }

      if (buttonType === "game_cleanup") {
        const mainChId = game.mainChannelId;
        const deletedCount = await gameManager.cleanupChannels(interaction.guild, game);
        gameManager.purgeGame(mainChId, game);
        // The summary (and thus the deferred reply) lives in the village channel
        // which was just deleted, so editReply would fail with 10008.
        // Send confirmation to the surviving main channel instead.
        const ok = await safeEditReply(interaction, { content: t('cleanup.button_success', { n: deletedCount }), flags: MessageFlags.Ephemeral });
        if (!ok) {
          try {
            const mainCh = await interaction.guild.channels.fetch(mainChId).catch(() => null);
            if (mainCh) await mainCh.send(t('cleanup.button_success', { n: deletedCount }));
          } catch { /* best-effort */ }
        }
        return;
      }

      // Rematch or Restart flow
      const isRematch = buttonType === "game_rematch";
      const previousPlayers = isRematch ? (game._previousPlayers || []) : [];
      
      const deletedCount = await gameManager.cleanupChannels(interaction.guild, game);
      gameManager.purgeGame(game.mainChannelId, game);

      const ok = gameManager.create(game.mainChannelId, {
        ...(game.rules || { minPlayers: 5, maxPlayers: 10 }),
        disableVoiceMute: game.disableVoiceMute || false
      });
      if (!ok) {
        await safeEditReply(interaction, { content: t('error.restart_impossible'), flags: MessageFlags.Ephemeral });
        return;
      }

      const newGame = gameManager.games.get(game.mainChannelId);
      newGame.lobbyHostId = interaction.user.id;
      newGame._lobbyCreatedAt = Date.now();

      const setupSuccess = await gameManager.createInitialChannels(
        interaction.guild,
        game.mainChannelId,
        newGame,
        CATEGORY_ID
      );

      if (!setupSuccess) {
        gameManager.purgeGame(game.mainChannelId);
        await safeEditReply(interaction, { content: t('error.channel_creation_button_failed'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Connect voice in background
      if (newGame.voiceChannelId) {
        gameManager.joinVoiceChannel(interaction.guild, newGame.voiceChannelId)
          .then(() => gameManager.playAmbience(newGame.voiceChannelId, 'night_ambience.mp3'))
          .catch(err => logger.error('VOICE_CONNECTION_FAILED', err));
      }

      // Create lobby embed
      const { buildLobbyMessage: buildLobbyMsg } = require('./utils/lobbyBuilder');

      // Auto-join players for rematch
      if (isRematch && previousPlayers.length > 0) {
        // Join the host first
        gameManager.join(game.mainChannelId, interaction.user);
        
        // Auto-join all previous players (except the host who's already joined)
        let joinedCount = 1;
        for (const prev of previousPlayers) {
          if (prev.id === interaction.user.id) continue; // Already joined as host
          try {
            const member = await interaction.guild.members.fetch(prev.id);
            if (member) {
              gameManager.join(game.mainChannelId, member.user);
              joinedCount++;
            }
          } catch (e) {
            logger.debug('REMATCH_REJOIN_FAILED', { userId: prev.id, error: e.message });
          }
        }
        logger.info('REMATCH_PLAYERS_JOINED', { count: joinedCount, total: previousPlayers.length });
      } else {
        gameManager.join(game.mainChannelId, interaction.user);
      }

      const lobbyPayload = buildLobbyMsg(newGame, interaction.user.id);
      const lobbyChannel = await interaction.guild.channels.fetch(game.mainChannelId);
      logger.info('LOBBY_MESSAGE_SENT', { channelId: lobbyChannel.id, channelName: lobbyChannel.name });
      const lobbyMsg = await lobbyChannel.send(lobbyPayload);
      newGame.lobbyMessageId = lobbyMsg.id;

      if (isRematch) {
        await safeEditReply(interaction, { content: t('cleanup.rematch_success', { n: newGame.players.length }), flags: MessageFlags.Ephemeral });
      } else {
        await safeEditReply(interaction, { content: t('cleanup.restart_success'), flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (buttonType === "lobby_join") {
      const game = gameManager.games.get(channelId);
      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      const alreadyJoined = game.players.some(p => p.id === interaction.user.id);
      if (alreadyJoined) {
        await safeEditReply(interaction, { content: t('error.already_joined') });
        return;
      }

      const joined = gameManager.join(channelId, interaction.user);
      if (joined) {
        await safeEditReply(interaction, { content: t('lobby.join_success_button', { name: interaction.user.username }) });
        await updateLobbyEmbed(interaction.guild, channelId);
      } else {
        await safeEditReply(interaction, { content: t('error.cannot_join') });
      }
      return;
    }

    if (buttonType === "lobby_leave") {
      const game = gameManager.games.get(channelId);
      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      const playerIdx = game.players.findIndex(p => p.id === interaction.user.id);
      if (playerIdx === -1) {
        await safeEditReply(interaction, { content: t('error.not_in_game_button') });
        return;
      }

      const isHost = interaction.user.id === game.lobbyHostId;
      game.players.splice(playerIdx, 1);
      // Sync player removal to DB
      try { gameManager.db.removePlayer(channelId, interaction.user.id); } catch (e) { /* ignore */ }

      // Si c'était l'hôte
      if (isHost) {
        // S'il y a encore d'autres joueurs, transférer le rôle d'hôte au premier
        if (game.players.length > 0) {
          const newHost = game.players[0];
          game.lobbyHostId = newHost.id;
          await safeEditReply(interaction, { 
            content: t('lobby.leave_host_transfer', { name: interaction.user.username, newHost: newHost.username }) 
          });
          await updateLobbyEmbed(interaction.guild, channelId);
          return;
        } 
        // Sinon, la partie est vide → nettoyer automatiquement
        else {
          await safeEditReply(interaction, { content: t('lobby.leave_auto_cleanup', { name: interaction.user.username }) });

          try {
            // Nettoyer les channels (même logique que /end)
            const deleted = await gameManager.cleanupChannels(interaction.guild, game);
            
            // Déconnecter le bot du channel vocal
            if (game.voiceChannelId) {
              try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
            }

            // Supprimer la partie de la mémoire, de la DB et sauvegarder
            gameManager.purgeGame(channelId, game);

            // D'abord envoyer le message de résultat
            const reply = await safeEditReply(interaction, t('lobby.auto_ended', { n: deleted }));

            // Puis nettoyer les anciens messages du bot (en excluant celui qu'on vient de créer)
            if (reply) {
              try {
                const channel = interaction.channel;
                if (channel) {
                  const messages = await channel.messages.fetch({ limit: 100 });
                  const botMessages = messages.filter(msg => msg.author.id === interaction.client.user.id && msg.id !== reply.id);
                  for (const msg of botMessages.values()) {
                    try { await msg.delete(); } catch (e) { /* ignore delete failures */ }
                  }
                }
              } catch (e) {
                logger.error('MESSAGE_CLEANUP_FAILED', e);
              }
              
              // Enfin, supprimer le message de réponse après 2 secondes
              setTimeout(() => {
                try { reply.delete(); } catch (e) { /* ignore */ }
              }, 2000);
            }
          } catch (err) {
            logger.error('LOBBY_LEAVE_CLEANUP_FAILED', err);
            await safeEditReply(interaction, t('error.cleanup_auto_error'));
          }
          return;
        }
      }

      // Joueur normal qui quitte
      await safeEditReply(interaction, { content: t('lobby.leave_success', { name: interaction.user.username }) });
      await updateLobbyEmbed(interaction.guild, channelId);
      return;
    }

    if (buttonType === "lobby_wolfwin") {
      const game = gameManager.games.get(channelId);
      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      // Seul le host ou un admin peut changer la condition de victoire
      const isAdmin = interaction.member.permissions.has('Administrator');
      const isHost = game.lobbyHostId === interaction.user.id;
      if (!isAdmin && !isHost) {
        await safeEditReply(interaction, { content: t('error.admin_or_host_required'), flags: MessageFlags.Ephemeral });
        return;
      }

      const ConfigManager = require('./utils/config');
      const config = ConfigManager.getInstance();
      const current = config.getWolfWinCondition(interaction.guildId);
      const newCondition = current === 'majority' ? 'elimination' : 'majority';
      config.setWolfWinCondition(newCondition, interaction.guildId);

      const label = newCondition === 'elimination' ? t('lobby.wolfwin_elimination') : t('lobby.wolfwin_majority');
      await safeEditReply(interaction, { content: t('lobby.wolfwin_changed', { condition: label }) });
      await updateLobbyEmbed(interaction.guild, channelId);
      return;
    }

    if (buttonType === "lobby_balance") {
      const game = gameManager.games.get(channelId);
      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      const result = gameManager.toggleBalanceMode(channelId, interaction.user.id);

      if (!result.success) {
        if (result.error === 'NOT_HOST') {
          await safeEditReply(interaction, { content: t('error.only_host_can_start'), flags: MessageFlags.Ephemeral });
          return;
        }
        if (result.error === 'ALREADY_STARTED') {
          await safeEditReply(interaction, { content: t('lobby.balance_locked'), flags: MessageFlags.Ephemeral });
          return;
        }
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      const modeLabel = result.newMode === 'CLASSIC' ? t('lobby.balance_classic') : t('lobby.balance_dynamic');
      await safeEditReply(interaction, { content: t('lobby.balance_changed', { mode: modeLabel }) });
      await updateLobbyEmbed(interaction.guild, channelId);
      return;
    }

    if (buttonType === "lobby_start") {
      const game = gameManager.games.get(channelId);
      if (!game) {
        await safeEditReply(interaction, { content: t('error.no_game_found_button') });
        return;
      }

      if (interaction.user.id !== game.lobbyHostId) {
        await safeEditReply(interaction, { content: t('error.only_host_can_start') });
        return;
      }

      if (game.players.length < (game.rules?.minPlayers || 5)) {
        await safeEditReply(interaction, { content: t('error.min_players_required', { min: game.rules?.minPlayers || 5, count: game.players.length }) });
        return;
      }

      try {
        // Démarrer le jeu avec les rôles par défaut
        // Use game.mainChannelId — guaranteed to be the Games Map key
        const startedGame = gameManager.start(game.mainChannelId);
        if (!startedGame) {
          await safeEditReply(interaction, t('error.cannot_start'));
          return;
        }

        const success = await gameManager.postStartGame(interaction.guild, startedGame, interaction.client, interaction);
        if (!success) {
          await safeEditReply(interaction, t('error.permissions_creation_failed'));
          return;
        }

        await safeEditReply(interaction, t('game.started_button'));
      } catch (err) {
        logger.error('LOBBY_START_FAILED', err);
        await safeEditReply(interaction, t('error.start_error'));
      }
      return;
    }

    // Suppression de la gestion des anciens boutons help (plus de pagination)
  }

  // ── Select menus for night role actions ──
  if (interaction.isStringSelectMenu()) {
    const ROLE_SELECT_IDS = ['wolves_kill', 'ww_kill', 'seer_see', 'salvateur_protect', 'witch_death', 'cupid_love'];
    if (ROLE_SELECT_IDS.includes(interaction.customId)) {
      const { safeDefer } = require('./utils/interaction');
      try {
        const deferred = await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
      } catch (err) {
        if (err.code === 10062) return;
        throw err;
      }
      const { handleNightSelect } = require('./interactions/nightActions');
      await handleNightSelect(interaction);
      return;
    }

    // ── Select menus for day village vote & captain tiebreak ──
    const DAY_SELECT_IDS = ['captain_elect', 'village_vote', 'captain_tiebreak'];
    if (DAY_SELECT_IDS.includes(interaction.customId)) {
      const { safeDefer } = require('./utils/interaction');
      try {
        const deferred = await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
      } catch (err) {
        if (err.code === 10062) return;
        throw err;
      }
      const { handleCaptainElect, handleVillageVote, handleCaptainTiebreak } = require('./interactions/dayActions');
      if (interaction.customId === 'captain_elect') {
        await handleCaptainElect(interaction);
      } else if (interaction.customId === 'village_vote') {
        await handleVillageVote(interaction);
      } else {
        await handleCaptainTiebreak(interaction);
      }
      return;
    }
  }
  }
  }); // end runWithContext
});

// Global error handlers
client.on('error', (error) => {
  if (error.code === 10062) {
    // Silently ignore "Unknown interaction" errors (expired interactions)
    return;
  }
  logger.error('CLIENT_ERROR', error);
});

// ─── Network / voice errors that should never crash the bot ──────
const isTransientNetworkError = (err) => {
  if (!err) return false;
  const msg = err.message || '';
  const code = err.code || '';
  return (
    code === 'ENOTFOUND' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    msg.includes('Cannot perform IP discovery') ||
    msg.includes('socket closed') ||
    msg.includes('getaddrinfo')
  );
};

process.on('unhandledRejection', (reason, promise) => {
  if (reason?.code === 10062) {
    // Silently ignore "Unknown interaction" errors
    return;
  }
  
  // Ignore transient voice/network errors (DNS, firewall, NAT)
  if (isTransientNetworkError(reason)) {
    logger.warn('UNHANDLED_REJECTION_NETWORK', { code: reason?.code, message: reason?.message });
    return;
  }
  
  logger.error('UNHANDLED_REJECTION', reason);
});

process.on('uncaughtException', (error) => {
  if (error.code === 10062) {
    // Silently ignore "Unknown interaction" errors
    return;
  }

  // Transient network/DNS errors must not crash the bot
  if (isTransientNetworkError(error)) {
    logger.warn('UNCAUGHT_NETWORK_ERROR', { code: error.code, message: error.message });
    return;
  }

  logger.fatal('UNCAUGHT_EXCEPTION', error);
  // Best-effort state save before crash
  try { gameManager.saveState(); } catch (e) { /* ignore */ }
  try { startupLock.release(); } catch (_) { /* ignore */ }
  process.exit(1);
});

// ─── Discord client resilience ─────────────────────────────────────
client.on('error', (error) => {
  logger.error('DISCORD_CLIENT_ERROR', error);
});

client.on('warn', (message) => {
  logger.warn('DISCORD_CLIENT_WARNING', { message });
});

client.on('shardError', (error) => {
  logger.error('SHARD_ERROR', error);
});

client.on('shardDisconnect', (event, shardId) => {
  logger.warn('SHARD_DISCONNECTED', { shardId, code: event?.code, reason: event?.reason });
});

client.on('shardReconnecting', (shardId) => {
  logger.info('SHARD_RECONNECTING', { shardId });
});

client.on('shardResume', (shardId, replayedEvents) => {
  logger.info('SHARD_RESUMED', { shardId, replayedEvents });
});

client.on('invalidated', () => {
  logger.fatal('SESSION_INVALIDATED');
  try { gameManager.saveState(); } catch (e) { /* ignore */ }
  try { startupLock.release(); } catch (_) { /* ignore */ }
  process.exit(1);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info('SHUTDOWN_STARTED', { signal });
  try {
    // Stop metrics collection
    try {
      const metrics = MetricsCollector.getInstance();
      metrics.stopCollection();
    } catch (e) { /* ignore */ }

    // Stop auto backup & run final backup
    try {
      const backup = BackupManager.getInstance();
      backup.stopAutoBackup();
      await backup.performBackup();
      logger.info('SHUTDOWN_BACKUP_DONE');
    } catch (e) { /* ignore */ }

    // Clear all game timers and save state
    gameManager.destroy();

    // Stop web dashboard
    try {
      if (webServer) await webServer.stop();
    } catch (e) { /* ignore */ }

    // Destroy rate limiter
    try {
      const rateLimiter = require('./utils/rateLimiter');
      rateLimiter.destroy();
    } catch (e) { /* ignore */ }

    // Disconnect voice connections
    const voiceManager = require('./game/voiceManager');
    for (const voiceChannelId of voiceManager.connections.keys()) {
      try { voiceManager.disconnect(voiceChannelId); } catch (e) { /* ignore */ }
    }

    // Destroy Discord client
    client.destroy();
    startupLock.release();
    logger.info('SHUTDOWN_COMPLETE');
  } catch (err) {
    logger.error('SHUTDOWN_ERROR', { error: err.message });
    try { startupLock.release(); } catch (_) { /* ignore */ }
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('exit', () => {
  try { startupLock.release(); } catch (_) { /* ignore */ }
});

client.login(process.env.TOKEN);
