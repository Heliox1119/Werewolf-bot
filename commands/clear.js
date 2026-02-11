const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { sendTemporaryMessage } = require("../utils/commands");
const { safeDefer } = require("../utils/interaction");
const { isAdmin, getCategoryId } = require("../utils/validators");
const { game: logger } = require("../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Nettoyer les channels résiduels du jeu (admin)"),

  async execute(interaction) {
    // Defer sans vérification de catégorie (clear doit marcher partout)
    await safeDefer(interaction);
    
    // Vérifier les permissions admin
    if (!isAdmin(interaction)) {
      await interaction.editReply({ content: "❌ Tu dois être administrateur", flags: MessageFlags.Ephemeral });
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
          logger.error('Erreur lors du démute avant suppression:', { error: e.message });
        }

        if (isGameChannel) {
          try {
            await channel.delete();
            deletedCount++;
            logger.info(`🗑️ Supprimé: ${channel.name}`);
          } catch (err) {
            logger.error(`❌ Erreur suppression ${channel.name}:`, { error: err.message });
          }
        }
      }

      // Nettoyer toutes les games en mémoire
      const gamesCount = gameManager.games.size;
      // Démuter et déconnecter les voix liées aux parties connues
      for (const [_, game] of gameManager.games.entries()) {
        if (game.voiceChannelId) {
          try {
            const voiceChan = await guild.channels.fetch(game.voiceChannelId);
            if (voiceChan) {
              for (const member of voiceChan.members.values()) {
                try { await member.voice.setMute(false); } catch (e) { /* ignore */ }
              }
            }
          } catch (e) {
            logger.error('Erreur demute lors du clear pour game voiceChannelId:', { error: e.message });
          }

          try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
        }
      }

      // Supprimer les games de la base de données
      for (const channelId of gameManager.games.keys()) {
        try { gameManager.db.deleteGame(channelId); } catch (e) { /* ignore */ }
      }
      // Also clean orphaned DB games (not in memory but still in DB)
      try {
        const dbGames = gameManager.db.getAllGames();
        for (const dbGame of dbGames) {
          try { gameManager.db.deleteGame(dbGame.channel_id); } catch (e) { /* ignore */ }
        }
      } catch (e) { /* ignore */ }
      gameManager.games.clear();
      gameManager.saveState();

      // Envoyer message temporaire avec nettoyage auto
      await sendTemporaryMessage(
        interaction,
        `🧹 **Nettoyage terminé !**\n\n` +
        `✅ ${deletedCount} channel(s) supprimé(s)\n` +
        `✅ ${gamesCount} partie(s) supprimée(s) de la mémoire`,
        2000
      );

    } catch (error) {
      logger.error("❌ Erreur clear:", { error: error.message });
      await interaction.editReply("❌ Erreur lors du nettoyage");
    }
  }
};
