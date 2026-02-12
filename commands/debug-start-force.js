const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-start-force")
    .setDescription("🐛 [DEBUG] Forcer le démarrage (ignore vérif joueurs)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.players.length === 0) {
      await interaction.reply({ content: "❌ Ajoute au moins 1 joueur d'abord", flags: MessageFlags.Ephemeral });
      return;
    }

    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Utiliser gameManager.start() — bypass du minimum via override
    // Si pas assez de joueurs pour les rôles, start() complète avec les Villageois
    const startedGame = gameManager.start(interaction.channelId);
    if (!startedGame) {
      // start() échoue si minPlayers non atteint, forcer manuellement
      const game2 = gameManager.games.get(interaction.channelId);
      if (game2) {
        game2.rules = { ...game2.rules, minPlayers: 1 };
        const retried = gameManager.start(interaction.channelId);
        if (!retried) {
          await interaction.editReply("❌ Impossible de démarrer");
          return;
        }
      } else {
        await interaction.editReply("❌ Impossible de démarrer");
        return;
      }
    }

    const finalGame = gameManager.games.get(interaction.channelId);
    const setupSuccess = await gameManager.postStartGame(interaction.guild, finalGame, interaction.client, interaction);

    if (!setupSuccess) {
      await interaction.editReply("❌ Erreur lors de setupChannels");
      return;
    }

    await interaction.editReply("🌙 Jeu lancé en debug !");
  }
};
