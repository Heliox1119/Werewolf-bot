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
    const timer = logger.startTimer('/create');
    
    // FIRST: Check for duplicate command (Discord auto-retry protection)
    if (gameManager.isRecentDuplicate('create', interaction.channelId, interaction.user.id)) {
      logger.warn('Ignoring duplicate /create (Discord retry)');
      await safeReply(interaction, { content: t('error.creation_in_progress'), flags: MessageFlags.Ephemeral });
      return;
    }

    // STEP 1: Try to respond ASAP to prevent Discord retries
    let deferSuccess = false;
    try {
      await interaction.deferReply();
      deferSuccess = true;
      logger.info('Interaction acknowledged');
    } catch (err) {
      if (err.code === 10062) {
        logger.warn('Interaction expired before defer - continuing anyway');
        // Can't prevent Discord retry, but our duplicate check will catch it
      } else if (err.code === 40060) {
        logger.warn('Interaction already acknowledged (Discord retry) - aborting');
        return; // Another retry already handled this
      } else {
        logger.error('Failed to defer', err);
      }
    }

    // STEP 2: Check if creation already in progress
    if (gameManager.creationsInProgress.has(interaction.channelId)) {
      logger.warn('Creation already in progress', { channelId: interaction.channelId });
      if (deferSuccess) {
        await interaction.editReply(t('error.creation_in_progress'));
      }
      return;
    }

    // STEP 3: Mark as in progress
    gameManager.creationsInProgress.add(interaction.channelId);
    logger.info('Starting game creation', { 
      channelId: interaction.channelId,
      user: interaction.user.username 
    });

    try {
      // Get category ID from configuration
      const ConfigManager = require('../utils/config');
      const config = ConfigManager.getInstance();
      const guildId = interaction.guildId;
      let CATEGORY_ID = config.getCategoryId(guildId);
      
      // Validate that the configured category actually exists on Discord
      if (CATEGORY_ID) {
        try {
          const cat = await interaction.guild.channels.fetch(CATEGORY_ID);
          if (!cat || cat.type !== 4) { // 4 = GuildCategory
            logger.warn('Configured category does not exist or is not a category, falling back', { CATEGORY_ID });
            CATEGORY_ID = null;
          }
        } catch {
          logger.warn('Configured category not found on Discord, falling back', { CATEGORY_ID });
          CATEGORY_ID = null;
        }
      }

      // Fallback: use the current channel's parent category
      if (!CATEGORY_ID) {
        const currentChannel = await interaction.guild.channels.fetch(interaction.channelId);
        if (currentChannel && currentChannel.parentId) {
          CATEGORY_ID = currentChannel.parentId;
          logger.info('Using current channel parent as category', { CATEGORY_ID });
        }
      }

      if (!CATEGORY_ID) {
        await interaction.editReply({
          content: t('error.not_configured'),
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      // Clean up any existing game/channels before creating a new game
      const oldGame = gameManager.games.get(interaction.channelId);
      if (oldGame) {
        logger.info('Found existing game, cleaning up...');
        const deletedCount = await gameManager.cleanupChannels(interaction.guild, oldGame);
        logger.success(`Cleaned up old game`, { deletedChannels: deletedCount });
        try { gameManager.db.deleteGame(interaction.channelId); } catch (e) { /* ignore */ }
        gameManager.games.delete(interaction.channelId);
        gameManager.saveState();
        
        // Wait a bit to ensure Discord API has processed deletions
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    const ok = gameManager.create(interaction.channelId, { guildId: interaction.guildId });
    if (!ok) {
      logger.warn('Failed to create game - already exists', { channelId: interaction.channelId });
      const errorMsg = t('error.game_already_exists');
      try {
        if (deferSuccess) {
          await interaction.editReply(errorMsg);
        } else {
          const channel = await interaction.guild.channels.fetch(interaction.channelId);
          await channel.send(errorMsg);
        }
      } catch (err) {
        logger.warn('Failed to send error message', { error: err.message });
      }
      return;
    }

    logger.success('Game created successfully', { 
      channelId: interaction.channelId,
      gamesCount: gameManager.games.size 
    });
    const game = gameManager.games.get(interaction.channelId);
    if (game) {
      gameManager.logAction(game, `Partie creee par ${interaction.user.username}`);
    }
    
    // Vérifier que la partie a bien été créée
    if (!game) {
      logger.error('CRITICAL: game.create() returned true but game not in Map!', { 
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
        logger.warn('Failed to send error message', { error: err.message });
      }
      return;
    }
    
    game.lobbyHostId = interaction.user.id;
    const defaultRules = config.getDefaultGameRules(interaction.guildId);
    const minPlayers = defaultRules.minPlayers || 5;
    const maxPlayers = defaultRules.maxPlayers || 10;
    game.rules = { minPlayers, maxPlayers };
    game._lobbyCreatedAt = Date.now();

    logger.debug('Creating initial channels', { categoryId: CATEGORY_ID });
    const setupSuccess = await gameManager.createInitialChannels(
      interaction.guild,
      interaction.channelId,
      game,
      CATEGORY_ID
    );

    if (!setupSuccess) {
      logger.error('Failed to create channels - rolling back', { channelId: interaction.channelId });
      try { gameManager.db.deleteGame(interaction.channelId); } catch (e) { /* ignore */ }
      gameManager.games.delete(interaction.channelId);
      const errorMsg = t('error.channel_creation_failed');
      try {
        if (deferSuccess) {
          await interaction.editReply(errorMsg);
        } else {
          const channel = await interaction.guild.channels.fetch(interaction.channelId);
          await channel.send(errorMsg);
        }
      } catch (err) {
        logger.warn('Failed to send error message', { error: err.message });
      }
      return;
    }

    // Connecter le bot au channel vocal EN ARRIÈRE-PLAN (sans attendre)
    if (game.voiceChannelId) {
      logger.debug('Connecting to voice channel', { voiceChannelId: game.voiceChannelId });
      gameManager.joinVoiceChannel(interaction.guild, game.voiceChannelId)
        .then(() => {
          logger.info('Connected to voice, playing ambience');
          return gameManager.playAmbience(game.voiceChannelId, 'night_ambience.mp3');
        })
        .catch(err => logger.error('Voice connection error', err));
    }

    logger.debug('Creating lobby embed');

    // Poster le message du lobby
    const lobbyChannel = await interaction.guild.channels.fetch(interaction.channelId);
    const lobbyPayload = buildLobbyMessage(game, interaction.user.id);
    logger.info('Channel send', { channelId: lobbyChannel.id, channelName: lobbyChannel.name, content: '[lobby message]' });
    const lobbyMsg = await lobbyChannel.send(lobbyPayload);
    game.lobbyMessageId = lobbyMsg.id;
    logger.debug('Lobby message posted', { messageId: lobbyMsg.id });

    // Ajouter le host automatiquement
    gameManager.join(interaction.channelId, interaction.user);
    logger.info('Host joined automatically', { user: interaction.user.username });

    // Répondre à l'interaction
    logger.debug('Sending final reply');
    const successMsg = t('create.success', { channelId: interaction.channelId });
    
    try {
      if (deferSuccess) {
        await interaction.editReply(successMsg);
      } else {
        // Use the already-fetched channel from lobbyChannel
        await lobbyChannel.send(successMsg);
      }
    } catch (err) {
      logger.warn('Failed to send success message', { error: err.message });
      // Game was created successfully anyway, just couldn't notify
    }
    
    timer.end();
    logger.success('✅ Game creation completed', { 
      channelId: interaction.channelId,
      gamesCount: gameManager.games.size,
      playerCount: game.players.length,
      activeGames: Array.from(gameManager.games.keys())
    });
    } finally {
      // Always remove from creationsInProgress, even if error
      gameManager.creationsInProgress.delete(interaction.channelId);
      logger.debug('Removed from creationsInProgress', { channelId: interaction.channelId });
    }
  }
};
