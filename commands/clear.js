const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { sendTemporaryMessage } = require("../utils/commands");
const { safeDefer } = require("../utils/interaction");
const { isAdmin, getCategoryId } = require("../utils/validators");
const { game: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Nettoyer les channels résiduels du jeu (admin)"),

  async execute(interaction) {
    // Defer sans vérification de catégorie (clear doit marcher partout)
    await safeDefer(interaction);
    
    // Vérifier les permissions admin
    if (!isAdmin(interaction)) {
      await interaction.editReply({ content: t('error.admin_required'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const guild = interaction.guild;
      const channels = await guild.channels.fetch();
      const CATEGORY_ID = getCategoryId();
      
      // Patterns de noms des channels du jeu (sans dépendre de l'emoji exact)
      const gameChannelPatterns = [
        "village",
        "loups",
        "voyante",
        "sorciere",
        "cupidon",
        "partie"
      ];

      let deletedCount = 0;
      
      for (const channel of channels.values()) {
        // Ne supprimer que les channels dans la catégorie du jeu
        if (CATEGORY_ID && channel.parentId !== CATEGORY_ID) continue;

        // Vérifier si le channel correspond à un pattern de jeu
        const isGameChannel = gameChannelPatterns.some(pattern => 
          channel.name.includes(pattern) || channel.name === pattern
        );

        // Si c'est un channel vocal de partie, démuter tout le monde connecté
        try {
          if (isGameChannel && channel.type === 2) {
            for (const member of channel.members.values()) {
              try { await member.voice.setMute(false); } catch (e) { /* ignore individual failures */ }
            }
          }
        } catch (e) {
          logger.error('UNMUTE_BEFORE_DELETE_ERROR', { error: e.message });
        }

        if (isGameChannel) {
          try {
            await channel.delete();
            deletedCount++;
            logger.info('CHANNEL_DELETED', { channelName: channel.name });
          } catch (err) {
            logger.error('CHANNEL_DELETE_ERROR', { channelName: channel.name, error: err.message });
          }
        }
      }

      // Nettoyer les games de CE serveur uniquement
      const guildId = interaction.guildId;
      const guildGames = Array.from(gameManager.games.entries()).filter(([, g]) => g.guildId === guildId);
      const gamesCount = guildGames.length;
      // Émettre gameEnded + déconnecter voix + purge (memory + DB + timers)
      for (const [channelId, game] of guildGames) {
        // Émettre gameEnded pour le dashboard web
        gameManager._emitGameEvent(game, 'gameEnded', {
          victor: null,
          reason: 'clear',
          players: game.players ? game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })) : []
        });

        // Démuter et déconnecter les voix
        if (game.voiceChannelId) {
          try {
            const voiceChan = await guild.channels.fetch(game.voiceChannelId);
            if (voiceChan) {
              for (const member of voiceChan.members.values()) {
                try { await member.voice.setMute(false); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) {
            logger.error('CLEAR_VOICE_UNMUTE_ERROR', { error: e.message });
          }

          try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
        }

        // Single source of truth: purge memory + DB + timers in one call
        gameManager.purgeGame(channelId, game);
      }

      // Also clean orphaned DB games for THIS guild (zombie rows not in memory)
      const zombiesPurged = gameManager.purgeGuildZombies(guildId);
      if (zombiesPurged > 0) {
        logger.warn('ZOMBIE_DB_ROWS_PURGED', { count: zombiesPurged, guildId });
      }

      // Envoyer message temporaire avec nettoyage auto
      await sendTemporaryMessage(
        interaction,
        t('cleanup.success', { channels: deletedCount, games: gamesCount + zombiesPurged }),
        2000
      );

    } catch (error) {
      logger.error('CLEAR_ERROR', { error: error.message });
      await interaction.editReply(t('error.cleanup_error'));
    }
  }
};
