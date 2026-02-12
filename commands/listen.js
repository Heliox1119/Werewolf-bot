const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
    .setDescription("Petite Fille : écouter les chuchotements des loups (DM)")
    ,

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.guild) {
      await safeReply(interaction, { content: "❌ Utilise cette commande depuis le serveur (pas en DM).", flags: MessageFlags.Ephemeral });
      return;
    }
    // Trouver la partie associée (par channel ou par joueur)
    let game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      game = Array.from(gameManager.games.values()).find(g => g.players.some(p => p.id === interaction.user.id));
    }
    if (!game) {
      await safeReply(interaction, { content: "❌ Tu ne fais partie d'aucune partie.", flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.PETITE_FILLE) {
      await safeReply(interaction, { content: "❌ Tu n'es pas la Petite Fille dans cette partie.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: "❌ Tu es mort·e et ne peux plus écouter.", flags: MessageFlags.Ephemeral });
      return;
    }

    // La Petite Fille ne peut espionner que pendant la sous-phase des loups
    const PHASES = require('../game/phases');
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: "❌ Tu ne peux écouter les loups que pendant la nuit !", flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: "❌ Les loups ne sont pas en train de délibérer.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.wolvesChannelId) {
      await safeReply(interaction, { content: "❌ Le channel des loups n'existe pas ou n'est pas encore créé.", flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
      if (!wolvesChannel) {
        await safeReply(interaction, { content: "❌ Impossible de récupérer le channel des loups.", flags: MessageFlags.Ephemeral });
        return;
      }

      const messages = await wolvesChannel.messages.fetch({ limit: 20 });
      const recent = Array.from(messages.values()).reverse().slice(-10);

      if (recent.length === 0) {
        await interaction.user.send("🔇 Il n'y a pas encore de messages dans le channel des loups.");
        await safeReply(interaction, { content: "✅ DM envoyé (vide)", flags: MessageFlags.Ephemeral });
        return;
      }

      const summary = recent.map(m => `• ${m.author.username}: ${m.content}`).join("\n");

      await interaction.user.send(`🔎 Résumé des derniers messages des loups :\n\n${summary}`);
      await safeReply(interaction, { content: "✅ Je t'ai envoyé les derniers chuchotements en DM.", flags: MessageFlags.Ephemeral });
    } catch (err) {
      logger.error("Erreur /listen:", { error: err.message });
      await safeReply(interaction, { content: "❌ Erreur lors de la récupération des messages.", flags: MessageFlags.Ephemeral });
    }
  }
};
