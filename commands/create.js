const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer, sendTemporaryMessage } = require("../utils/commands");
const { safeReply } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");
const { t, translateRole } = require('../utils/i18n');
const { buildLobbyMessage } = require("../utils/lobbyBuilder");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("create")
    .setDescription("Créer une partie de loup-garou"),

  async execute(interaction) {
    const timer = logger.startTimer('CREATE');
    
    // FIRST: Check for duplicate command (Discord auto-retry protection)
    if (gameManager.isRecentDuplicate('create', interaction.channelId, interaction.user.id)) {
      logger.warn('DUPLICATE_CREATE_IGNORED');
      await safeReply(interaction, { content: t('error.creation_in_progress'), flags: MessageFlags.Ephemeral });
      return;
    }

    // GUARD: Refuse if guild is not properly configured (no guild-scoped category)
    const ConfigManager = require('../utils/config');
    const config = ConfigManager.getInstance();
    const guildId = interaction.guildId;
    if (!config.isSetupComplete(guildId)) {
      logger.warn('GUILD_NOT_CONFIGURED', { guildId });
      await safeReply(interaction, { content: t('error.not_configured_run_setup'), flags: MessageFlags.Ephemeral });
      return;
    }

    // STEP 1: Try to respond ASAP to prevent Discord retries
    let deferSuccess = false;
    try {
      await interaction.deferReply();
      deferSuccess = true;
      logger.info('INTERACTION_ACKNOWLEDGED');
    } catch (err) {
      if (err.code === 10062) {
        logger.warn('INTERACTION_EXPIRED_BEFORE_DEFER');
        // Can't prevent Discord retry, but our duplicate check will catch it
      } else if (err.code === 40060) {
        logger.warn('INTERACTION_ALREADY_ACKNOWLEDGED');
        return; // Another retry already handled this
      } else {
        logger.error('DEFER_FAILED', err);
      }
    }

    // STEP 2: Check if creation already in progress
    if (gameManager.creationsInProgress.has(interaction.channelId)) {
      logger.warn('CREATION_ALREADY_IN_PROGRESS', { channelId: interaction.channelId });
      if (deferSuccess) {
        await interaction.editReply(t('error.creation_in_progress'));
      }
      return;
    }

    // STEP 3: Mark as in progress
    gameManager.creationsInProgress.add(interaction.channelId);
    logger.info('GAME_CREATION_STARTED', { 
      channelId: interaction.channelId,
      user: interaction.user.username 
    });

    try {
      // Get category ID from guild-scoped configuration (no fallback)
      let CATEGORY_ID = config.get(`guild.${guildId}.discord.category_id`);
      
      // Validate that the configured category actually exists on Discord
      if (CATEGORY_ID) {
        try {
          const cat = await interaction.guild.channels.fetch(CATEGORY_ID);
          if (!cat || cat.type !== 4) { // 4 = GuildCategory
            logger.warn('CATEGORY_INVALID', { CATEGORY_ID });
            CATEGORY_ID = null;
          }
        } catch {
          logger.warn('CATEGORY_NOT_FOUND', { CATEGORY_ID });
          CATEGORY_ID = null;
        }
      }

      // No fallback — if category is invalid, refuse
      if (!CATEGORY_ID) {
        if (deferSuccess) {
          await interaction.editReply({
            content: t('error.not_configured_run_setup')
          });
        }
        return;
      }

      // Clean up any existing game/channels before creating a new game
      const oldGame = gameManager.games.get(interaction.channelId);
      if (oldGame) {
        logger.info('EXISTING_GAME_CLEANUP_STARTED');
        const deletedCount = await gameManager.cleanupChannels(interaction.guild, oldGame);
        logger.info('OLD_GAME_CLEANED_UP', { deletedChannels: deletedCount });
        gameManager.purgeGame(interaction.channelId, oldGame);
        
        // Wait a bit to ensure Discord API has processed deletions
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        // No in-memory game — but reconciler in create() will handle any DB zombie
        logger.debug('NO_IN_MEMORY_GAME_ZOMBIE_DELEGATED');
      }

    const ok = gameManager.create(interaction.channelId, { guildId: interaction.guildId });
    if (!ok) {
      logger.warn('GAME_ALREADY_EXISTS', { channelId: interaction.channelId });
      const errorMsg = t('error.game_already_exists');
      try {
        if (deferSuccess) {
          await interaction.editReply(errorMsg);
        } else {
          const channel = await interaction.guild.channels.fetch(interaction.channelId);
          await channel.send(errorMsg);
        }
      } catch (err) {
        logger.warn('ERROR_MESSAGE_SEND_FAILED', { error: err.message });
      }
      return;
    }

    logger.info('GAME_CREATED', { 
      channelId: interaction.channelId,
      gamesCount: gameManager.games.size 
    });
    const game = gameManager.games.get(interaction.channelId);
    if (game) {
      gameManager.logAction(game, `Partie creee par ${interaction.user.username}`);
    }
    
    // Vérifier que la partie a bien été créée
    if (!game) {
      logger.error('GAME_CREATE_MAP_INCONSISTENCY', { 
        channelId: interaction.channelId 
      });
      const errorMsg = t('error.critical_creation');
      try {
        if (deferSuccess) {
          await interaction.editReply(errorMsg);
        } else {
          const channel = await interaction.guild.channels.fetch(interaction.channelId);
          await channel.send(errorMsg);
        }
      } catch (err) {
        logger.warn('ERROR_MESSAGE_SEND_FAILED', { error: err.message });
      }
      return;
    }
    
    const defaultRules = config.getDefaultGameRules(interaction.guildId);
    const minPlayers = defaultRules.minPlayers || 5;
    const maxPlayers = defaultRules.maxPlayers || 10;
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.lobbyHostId = interaction.user.id;
      state.rules = { minPlayers, maxPlayers };
      state._lobbyCreatedAt = Date.now();
    });

    logger.debug('INITIAL_CHANNELS_CREATING', { categoryId: CATEGORY_ID });
    const setupSuccess = await gameManager.createInitialChannels(
      interaction.guild,
      interaction.channelId,
      game,
      CATEGORY_ID
    );

    if (!setupSuccess) {
      logger.error('CHANNEL_CREATION_ROLLBACK', { channelId: interaction.channelId });
      gameManager.purgeGame(interaction.channelId);
      const errorMsg = t('error.channel_creation_failed');
      try {
        if (deferSuccess) {
          await interaction.editReply(errorMsg);
        } else {
          const channel = await interaction.guild.channels.fetch(interaction.channelId);
          await channel.send(errorMsg);
        }
      } catch (err) {
        logger.warn('ERROR_MESSAGE_SEND_FAILED', { error: err.message });
      }
      return;
    }

    // Connecter le bot au channel vocal EN ARRIÈRE-PLAN (sans attendre)
    if (game.voiceChannelId) {
      logger.debug('VOICE_CHANNEL_CONNECTING', { voiceChannelId: game.voiceChannelId });
      gameManager.joinVoiceChannel(interaction.guild, game.voiceChannelId)
        .then(() => {
          logger.info('VOICE_CONNECTED_AMBIENCE_PLAYING');
          return gameManager.playAmbience(game.voiceChannelId, 'night_ambience.mp3');
        })
        .catch(err => logger.error('VOICE_CONNECTION_ERROR', err));
    }

    logger.debug('LOBBY_EMBED_CREATING');

    // Poster le message du lobby
    const lobbyChannel = await interaction.guild.channels.fetch(interaction.channelId);
    const lobbyPayload = buildLobbyMessage(game, interaction.user.id);
    logger.info('CHANNEL_SEND', { channelId: lobbyChannel.id, channelName: lobbyChannel.name, content: '[lobby message]' });
    const lobbyMsg = await lobbyChannel.send(lobbyPayload);
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.lobbyMessageId = lobbyMsg.id;
    });
    logger.debug('LOBBY_MESSAGE_POSTED', { messageId: lobbyMsg.id });

    // Ajouter le host automatiquement
    gameManager.join(interaction.channelId, interaction.user);
    logger.info('HOST_AUTO_JOINED', { user: interaction.user.username });

    // Répondre à l'interaction
    logger.debug('FINAL_REPLY_SENDING');
    const successMsg = t('create.success', { channelId: interaction.channelId });
    
    try {
      if (deferSuccess) {
        await interaction.editReply(successMsg);
      } else {
        // Use the already-fetched channel from lobbyChannel
        await lobbyChannel.send(successMsg);
      }
    } catch (err) {
      logger.warn('SUCCESS_MESSAGE_SEND_FAILED', { error: err.message });
      // Game was created successfully anyway, just couldn't notify
    }
    
    timer.end();
    logger.info('GAME_CREATION_COMPLETED', { 
      channelId: interaction.channelId,
      gamesCount: gameManager.games.size,
      playerCount: game.players.length,
      activeGames: Array.from(gameManager.games.keys())
    });
    } finally {
      // Always remove from creationsInProgress, even if error
      gameManager.creationsInProgress.delete(interaction.channelId);
      logger.debug('CREATION_IN_PROGRESS_REMOVED', { channelId: interaction.channelId });
    }
  }
};
