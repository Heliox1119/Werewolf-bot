require("dotenv").config();

const { Client, GatewayIntentBits, Collection, REST, Routes, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const fs = require("fs");
const path = require("path");
const gameManager = require("./game/gameManager");
const { app: logger, discord: discordLogger, interaction: interactionLogger } = require("./utils/logger");
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
    console.error(`❌ Variable d'environnement manquante: ${key}. Vérifiez votre fichier .env`);
    process.exit(1);
  }
}

// Inter-process startup lock (split-brain protection)
const lockResult = startupLock.acquire();
if (!lockResult.ok) {
  logger.critical('Refusing startup: another bot instance appears to be running', {
    reason: lockResult.reason,
    ownerPid: lockResult.ownerPid,
    ownerStartedAt: lockResult.ownerStartedAt,
    lockFilePath: lockResult.lockFilePath,
    error: lockResult.error ? lockResult.error.message : undefined
  });
  process.exit(1);
}
logger.info('Startup lock acquired', {
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
  logger.debug('Command loaded with rate limiting', { name: command.data.name });
}

// Bot prêt
client.once("clientReady", async () => {
  logger.success(`🐺 Connected as ${client.user.tag}`);
  logger.info('Registering slash commands...');

  // Initialiser le système de configuration
  try {
    const ConfigManager = require('./utils/config');
    const GameDatabase = require('./database/db');
    const db = new GameDatabase();
    ConfigManager.initialize(db.db); // Passer l'objet SQLite directement
    
    const config = ConfigManager.getInstance();
    logger.success('Configuration system initialized');

    // Initialiser le système i18n
    const i18n = require('./utils/i18n');
    i18n.initialize(db.db);
    
    // Vérifier si le setup est complet
    if (!config.isSetupComplete()) {
      logger.warn('Bot setup incomplete! Use /setup wizard to configure');
      const missing = config.getMissingSetupKeys();
      logger.warn('Missing configuration:', { keys: missing.map(m => m.key) });
    } else {
      logger.success('Bot configuration complete');
    }
  } catch (error) {
    logger.error('Failed to initialize configuration system', { error: error.message });
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
    
    logger.success('Monitoring system initialized', { 
      interval: `${metricsInterval / 1000}s`,
      alertsEnabled: config.isMonitoringAlertsEnabled()
    });
    
    // Envoyer une alerte de démarrage si webhook configuré
    if (webhookUrl) {
      const packageJson = require('./package.json');
      await alerts.alertBotStarted(packageJson.version, 'N/A');
    }
  } catch (error) {
    logger.error('Failed to initialize monitoring system', { error: error.message });
  }

  // Initialiser le système de backup automatique
  try {
    const GameDatabase = require('./database/db');
    const backupDb = new GameDatabase();
    BackupManager.initialize(backupDb);
    const backup = BackupManager.getInstance();
    backup.startAutoBackup();
    logger.success('Backup system initialized (hourly, keep 24)');
  } catch (error) {
    logger.error('Failed to initialize backup system', { error: error.message });
  }

  // Initialiser le système d'achievements & ELO
  try {
    gameManager.initAchievements();
  } catch (error) {
    logger.error('Failed to initialize achievement system', { error: error.message });
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
    logger.error('Failed to initialize web dashboard', { error: error.message, stack: error.stack });
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
      logger.success("✅ Slash commands registered (guild instant)", { guildId: process.env.GUILD_ID, count: client.commands.size });
    } else {
      // Pas de GUILD_ID → enregistrement global (propagation ~1h pour les nouveaux serveurs)
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commandsJson }
      );
      logger.success("✅ Slash commands registered (global)", { count: client.commands.size });
    }

    // Auto-enregistrer les commandes quand le bot rejoint un nouveau serveur
    client.on('guildCreate', async (guild) => {
      try {
        await rest.put(
          Routes.applicationGuildCommands(process.env.CLIENT_ID, guild.id),
          { body: commandsJson }
        );
        logger.success(`✅ Slash commands registered for new guild`, { guildId: guild.id, guildName: guild.name });
      } catch (err) {
        logger.error(`Failed to register commands for new guild`, { guildId: guild.id, error: err.message });
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
            logger.warn(`⚠️ Missing permissions in ${guild.name}`, { guildId, missing });
          } else {
            logger.success(`✅ All permissions OK in ${guild.name}`, { guildId });
          }
        } catch (err) {
          logger.error(`Could not verify permissions in ${guild.name}`, err);
        }
      }
      // ──────────────────────────────────────────────────────────────

      // Load saved game state BEFORE orphan cleanup so channels are recognized
      try {
        logger.info('Loading saved game state...');
        gameManager.loadState();
        logger.info('Games loaded from DB', { count: gameManager.games.size });
      } catch (err) {
        logger.error('❌ Game state load failed', err);
      }

      // ─── Guild reconciliation: purge data for guilds bot left ─────
      try {
        const { reconcileGuildsOnStartup } = require('./game/guildReconciler');
        const result = reconcileGuildsOnStartup(client, gameManager.db, gameManager);
        if (result.removed.length > 0) {
          logger.info('Guild reconciliation done', { removed: result.removed.length, kept: result.kept.length });
        }
      } catch (err) {
        logger.error('Guild reconciliation failed', { error: err.message });
      }
      // ──────────────────────────────────────────────────────────────

      // ─── Orphan channel cleanup ───────────────────────────────────
      try {
        logger.info('Checking for orphan game channels...');
        for (const [guildId, guild] of client.guilds.cache) {
          const gameChannelPrefixes = ['🐺', '🏘️', '🏘', '🔮', '🧪', '💘', '❤️', '❤', '🛡️', '🛡', '👻', '🎤'];
          const channels = guild.channels.cache.filter(ch => 
            ch.name && ch.type !== 4 && // Never delete categories (type 4)
            gameChannelPrefixes.some(prefix => ch.name.startsWith(prefix))
          );
          for (const [chId, ch] of channels) {
            // Si ce channel n'appartient à aucune partie connue, le supprimer
            const isOwned = Array.from(gameManager.games.values()).some(g =>
              g.voiceChannelId === chId || g.villageChannelId === chId ||
              g.wolvesChannelId === chId || g.seerChannelId === chId ||
              g.witchChannelId === chId || g.cupidChannelId === chId ||
              g.salvateurChannelId === chId || g.spectatorChannelId === chId ||
              g.thiefChannelId === chId || g.whiteWolfChannelId === chId
            );
            if (!isOwned) {
              try {
                // Check bot permissions before attempting to delete
                const botMember = guild.members.me;
                if (!botMember) continue;
                const botPerms = ch.permissionsFor(botMember);
                if (!botPerms || !botPerms.has('ViewChannel') || !botPerms.has('ManageChannels')) {
                  continue; // Silently skip — bot cannot manage this channel
                }
                await ch.delete('Orphan game channel cleanup');
                logger.info('Deleted orphan channel', { name: ch.name, id: chId, guild: guild.name });
              } catch (e) {
                // Silently ignore Missing Access/Permissions errors (50001, 50013)
                if (e.code === 50001 || e.code === 50013) continue;
                logger.error('Failed to delete orphan channel', e);
              }
            }
          }
        }
      } catch (err) {
        logger.error('Orphan cleanup failed', err);
      }
      // ──────────────────────────────────────────────────────────────

      // Restaurer les parties chargées et tenter une restauration minimale
      try {
        logger.info('Restoring games...', { count: gameManager.games.size });
        for (const [channelId, game] of gameManager.games.entries()) {
          // Résoudre le guild de cette partie
          const guild = game.guildId 
            ? (client.guilds.cache.get(game.guildId) || await client.guilds.fetch(game.guildId).catch(() => null))
            : null;

          if (!guild) {
            logger.warn('Restored game has unknown guild, removing', { channelId, guildId: game.guildId });
            try { gameManager.db.deleteGame(channelId); } catch (e) { /* ignore */ }
            gameManager.games.delete(channelId);
            gameManager.saveState();
            continue;
          }

          // Validate main channel still exists
          const mainChannel = await guild.channels.fetch(game.mainChannelId).catch(() => null);
          if (!mainChannel) {
            logger.warn('Restored game has missing main channel, removing', { channelId, mainChannelId: game.mainChannelId });
            try { gameManager.db.deleteGame(channelId); } catch (e) { /* ignore */ }
            gameManager.games.delete(channelId);
            gameManager.saveState();
            continue;
          }

          // Reconnect voice only if voice channel exists
          if (game.voiceChannelId) {
            const voiceChannel = await guild.channels.fetch(game.voiceChannelId).catch(() => null);
            if (voiceChannel) {
              gameManager.joinVoiceChannel(guild, game.voiceChannelId)
                .then(() => logger.debug('Voice reconnected', { channelId, voiceChannelId: game.voiceChannelId }))
                .catch(e => logger.error('Restore voice error', e));
            } else {
              logger.warn('Restored game has missing voice channel, clearing', { channelId, voiceChannelId: game.voiceChannelId });
              game.voiceChannelId = null;
              gameManager.saveState();
            }
          }

          // Rafraîchir le lobby embed si présent
          try { await updateLobbyEmbed(guild, channelId); } catch (e) { /* ignore */ }

          // Re-arm timers: lobby timeout for games not yet started
          if (!game.startedAt) {
            gameManager.setLobbyTimeout(channelId);
            logger.debug('Re-armed lobby timeout for restored game', { channelId });
          } else {
            // Re-arm gameplay timers for in-progress games
            const PHASES = require('./game/phases');
            const nightActionPhases = [PHASES.VOLEUR, PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE, PHASES.SALVATEUR, PHASES.CUPIDON];
            if (game.phase === PHASES.NIGHT && nightActionPhases.includes(game.subPhase)) {
              gameManager.startNightAfkTimeout(guild, game);
              logger.debug('Re-armed night AFK timeout for restored game', { channelId, subPhase: game.subPhase });
            } else if (game.phase === PHASES.NIGHT && game.subPhase === PHASES.REVEIL) {
              // Was about to transition to day — do it now
              gameManager.transitionToDay(guild, game).catch(e => logger.error('Restore transitionToDay error', { error: e.message }));
              logger.debug('Resuming day transition for restored game', { channelId });
            } else if (game.phase === PHASES.DAY) {
              if (game.subPhase === PHASES.DELIBERATION) {
                gameManager.startDayTimeout(guild, game, 'deliberation');
                logger.debug('Re-armed deliberation timeout for restored game', { channelId });
              } else if (game.subPhase === PHASES.VOTE) {
                gameManager.startDayTimeout(guild, game, 'vote');
                logger.debug('Re-armed vote timeout for restored game', { channelId });
              } else if (game.subPhase === PHASES.VOTE_CAPITAINE) {
                gameManager.startCaptainVoteTimeout(guild, game);
                logger.debug('Re-armed captain vote timeout for restored game', { channelId });
              }
            }

            // Re-arm hunter shoot timeout if hunter was waiting to shoot
            if (game._hunterMustShoot) {
              gameManager.startHunterTimeout(guild, game, game._hunterMustShoot);
              logger.debug('Re-armed hunter shoot timeout for restored game', { channelId, hunterId: game._hunterMustShoot });
            }

            // Re-arm captain tiebreak timeout if tiebreak was in progress
            if (game._captainTiebreak && Array.isArray(game._captainTiebreak) && game._captainTiebreak.length > 0) {
              gameManager.startCaptainTiebreakTimeout(guild, game);
              logger.debug('Re-armed captain tiebreak timeout for restored game', { channelId, tiedIds: game._captainTiebreak });
            }
          }
        }
      } catch (err) {
        logger.error('❌ Game state restoration failed', err);
      }

      // Archive old completed games (cleanup DB)
      try {
        const archived = gameManager.db.archiveOldGames(7);
        if (archived > 0) logger.info(`🗃️ Archived ${archived} old games from DB`);
      } catch (err) {
        logger.error('Game archiving failed', err);
      }
  } catch (error) {
    logger.error("❌ Failed to register commands", error);
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
    logger.error("❌ Erreur rafraîchissement lobby:", { message: err.message });
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
      logger.warn('Bot missing MuteMembers permission — cannot mute/unmute players');
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
    logger.error('voiceStateUpdate error', { error: err.message });
  }
});

// ─── Petite Fille : relais anonymisé des messages loups ──────────────────────
client.on('messageCreate', async (message) => {
  try {
    // Ignorer les messages du bot
    if (message.author.bot) return;

    // Chercher une partie dont le wolvesChannelId correspond
    const game = Array.from(gameManager.games.values()).find(g => g.wolvesChannelId === message.channelId);
    if (!game) return;

    // Vérifier qu'un relais est actif
    if (!game.listenRelayUserId) return;

    // Vérifier que c'est bien la phase des loups
    const PHASES = require('./game/phases');
    if (game.phase !== PHASES.NIGHT || game.subPhase !== PHASES.LOUPS) {
      game.listenRelayUserId = null;
      return;
    }

    // Relayer le message en DM anonymisé
    const { t } = require('./utils/i18n');
    const user = await client.users.fetch(game.listenRelayUserId);
    await user.send(t('cmd.listen.relay_message', { content: message.content }));
  } catch (err) {
    // Silently ignore relay errors (user DM closed, etc.)
  }
});

client.on("interactionCreate", async interaction => {
  // Ignorer les interactions en DM (toutes les commandes nécessitent un serveur)
  if (!interaction.guild) {
    try { await interaction.reply({ content: t('error.bot_only_in_server'), ephemeral: true }); } catch (e) { /* ignore */ }
    return;
  }

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
          interactionLogger.info('Reply sent', {
            command: interaction.commandName || 'unknown',
            channelId: interaction.channelId || 'unknown',
            userId: interaction.user?.id || 'unknown',
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('Reply failed', { error: err.message, code: err.code });
          throw err;
        }
      };
    }

    const originalEditReply = interaction.editReply?.bind(interaction);
    if (originalEditReply) {
      interaction.editReply = async (payload) => {
        try {
          const result = await originalEditReply(payload);
          interactionLogger.info('Reply edited', {
            command: interaction.commandName || 'unknown',
            channelId: interaction.channelId || 'unknown',
            userId: interaction.user?.id || 'unknown',
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('EditReply failed', { error: err.message, code: err.code });
          throw err;
        }
      };
    }

    const originalFollowUp = interaction.followUp?.bind(interaction);
    if (originalFollowUp) {
      interaction.followUp = async (payload) => {
        try {
          const result = await originalFollowUp(payload);
          interactionLogger.info('FollowUp sent', {
            command: interaction.commandName || 'unknown',
            channelId: interaction.channelId || 'unknown',
            userId: interaction.user?.id || 'unknown',
            content: formatContent(payload)
          });
          return result;
        } catch (err) {
          interactionLogger.warn('FollowUp failed', { error: err.message, code: err.code });
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
        logger.info('Command received', {
          command: `/${interaction.commandName}`,
          user: interaction.user?.username || 'unknown',
          userId: interaction.user?.id || 'unknown',
          channelId: interaction.channelId,
          guildId: interaction.guildId
        });
        await command.execute(interaction);
      } catch (err) {
        commandSuccess = false;
        logger.error('Command execution error', err);
        
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

    // ── Thief role buttons (ephemeral defer) ──
    if (interaction.customId.startsWith('thief_')) {
      try {
        const deferred = await safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return; // interaction expired
      } catch (err) {
        if (err.code === 10062) return;
        throw err;
      }
      const { handleThiefButton } = require('./interactions/thiefButtons');
      await handleThiefButton(interaction);
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
        const deletedCount = await gameManager.cleanupChannels(interaction.guild, game);
        try { gameManager.db.deleteGame(game.mainChannelId); } catch (e) { /* ignore */ }
        gameManager.games.delete(game.mainChannelId);
        gameManager.saveState();
        await safeEditReply(interaction, { content: t('cleanup.button_success', { n: deletedCount }), flags: MessageFlags.Ephemeral });
        return;
      }

      // Rematch or Restart flow
      const isRematch = buttonType === "game_rematch";
      const previousPlayers = isRematch ? (game._previousPlayers || []) : [];
      
      const deletedCount = await gameManager.cleanupChannels(interaction.guild, game);
      try { gameManager.db.deleteGame(game.mainChannelId); } catch (e) { /* ignore */ }
      gameManager.games.delete(game.mainChannelId);
      gameManager.saveState();

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
        try { gameManager.db.deleteGame(game.mainChannelId); } catch (e) { /* ignore */ }
        gameManager.games.delete(game.mainChannelId);
        await safeEditReply(interaction, { content: t('error.channel_creation_button_failed'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Connect voice in background
      if (newGame.voiceChannelId) {
        gameManager.joinVoiceChannel(interaction.guild, newGame.voiceChannelId)
          .then(() => gameManager.playAmbience(newGame.voiceChannelId, 'night_ambience.mp3'))
          .catch(err => logger.error('Voice connection error', err));
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
            logger.debug('Rematch: could not re-add player', { userId: prev.id, error: e.message });
          }
        }
        logger.info('Rematch: auto-joined players', { count: joinedCount, total: previousPlayers.length });
      } else {
        gameManager.join(game.mainChannelId, interaction.user);
      }

      const lobbyPayload = buildLobbyMsg(newGame, interaction.user.id);
      const lobbyChannel = await interaction.guild.channels.fetch(game.mainChannelId);
      logger.info('Channel send', { channelId: lobbyChannel.id, channelName: lobbyChannel.name, content: '[lobby message]' });
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
            try { gameManager.db.deleteGame(channelId); } catch (e) { /* ignore */ }
            gameManager.games.delete(channelId);
            try { await gameManager.saveState(); } catch (e) { /* best effort */ }

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
                logger.error('Failed to cleanup messages', e);
              }
              
              // Enfin, supprimer le message de réponse après 2 secondes
              setTimeout(() => {
                try { reply.delete(); } catch (e) { /* ignore */ }
              }, 2000);
            }
          } catch (err) {
            logger.error("❌ Erreur nettoyage automatique lobby_leave:", err);
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
        const startedGame = gameManager.start(channelId);
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
        logger.error("❌ Erreur démarrage depuis lobby:", err);
        await safeEditReply(interaction, t('error.start_error'));
      }
      return;
    }

    // Suppression de la gestion des anciens boutons help (plus de pagination)
  }
  }
});

// Global error handlers
client.on('error', (error) => {
  if (error.code === 10062) {
    // Silently ignore "Unknown interaction" errors (expired interactions)
    return;
  }
  logger.error('Client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  if (reason?.code === 10062) {
    // Silently ignore "Unknown interaction" errors
    return;
  }
  
  // Ignore voice connection UDP errors (firewall/NAT issues)
  if (reason?.message?.includes('Cannot perform IP discovery') || 
      reason?.message?.includes('socket closed')) {
    return;
  }
  
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  if (error.code === 10062) {
    // Silently ignore "Unknown interaction" errors
    return;
  }
  logger.critical('Uncaught Exception — saving state before crash', error);
  // Best-effort state save before crash
  try { gameManager.saveState(); } catch (e) { /* ignore */ }
  try { startupLock.release(); } catch (_) { /* ignore */ }
  process.exit(1);
});

// ─── Discord client resilience ─────────────────────────────────────
client.on('error', (error) => {
  logger.error('Discord client error', error);
});

client.on('warn', (message) => {
  logger.warn('Discord client warning', { message });
});

client.on('shardError', (error) => {
  logger.error('WebSocket shard error', error);
});

client.on('shardDisconnect', (event, shardId) => {
  logger.warn(`Shard ${shardId} disconnected`, { code: event?.code, reason: event?.reason });
});

client.on('shardReconnecting', (shardId) => {
  logger.info(`Shard ${shardId} reconnecting...`);
});

client.on('shardResume', (shardId, replayedEvents) => {
  logger.success(`Shard ${shardId} resumed`, { replayedEvents });
});

client.on('invalidated', () => {
  logger.critical('Session invalidated — restarting...');
  try { gameManager.saveState(); } catch (e) { /* ignore */ }
  try { startupLock.release(); } catch (_) { /* ignore */ }
  process.exit(1);
});

// Graceful shutdown
async function gracefulShutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully...`);
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
      logger.info('Final backup completed');
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
    logger.info('Shutdown complete');
  } catch (err) {
    logger.error('Shutdown error', { error: err.message });
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
