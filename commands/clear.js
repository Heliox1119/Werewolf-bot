const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer, sendTemporaryMessage } = require("../utils/commands");
const { isAdmin } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Nettoyer les channels résiduels du jeu (admin)"),

  async execute(interaction) {
    // Vérification catégorie et defer
    if (!await checkCategoryAndDefer(interaction)) return;
    
    // Vérifier les permissions admin
    if (!isAdmin(interaction)) {
      await interaction.editReply({ content: "❌ Tu dois être administrateur", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const guild = interaction.guild;
      const channels = await guild.channels.fetch();
      
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
          console.error('Erreur lors du démute avant suppression:', e.message);
        }

        if (isGameChannel) {
          try {
            await channel.delete();
            deletedCount++;
            console.log(`🗑️ Supprimé: ${channel.name}`);
          } catch (err) {
            console.error(`❌ Erreur suppression ${channel.name}:`, err.message);
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
            console.error('Erreur demute lors du clear pour game voiceChannelId:', e.message);
          }

          try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
        }
      }

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
      console.error("❌ Erreur clear:", error);
      await interaction.editReply("❌ Erreur lors du nettoyage");
    }
  }
};
