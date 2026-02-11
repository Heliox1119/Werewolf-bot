const { SlashCommandBuilder, ChannelType, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("nextphase")
    .setDescription("Passer à la phase suivante (Nuit ↔ Jour)"),

  async execute(interaction) {
    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
      const { safeReply } = require('../utils/interaction');
      await safeReply(interaction, { content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      const { safeReply } = require('../utils/interaction');
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.phase === PHASES.NIGHT) {
      await gameManager.transitionToDay(interaction.guild, game);
      await interaction.editReply('✅ Phase avancée (debug)');
      return;
    }

    if (game.phase === PHASES.DAY) {
      await gameManager.transitionToNight(interaction.guild, game);
      await interaction.editReply('✅ Phase avancée (debug)');
      return;
    }
  }
};
