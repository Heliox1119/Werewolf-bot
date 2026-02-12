const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
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

    // Distribuer les rôles
    const candidateRoles = [
      ROLES.WEREWOLF,
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
      ROLES.PETITE_FILLE,
      ROLES.CUPID
    ];

    let rolesPool = candidateRoles.slice(0, game.players.length);
    game.players.forEach(p => {
      const role = rolesPool.splice(Math.floor(Math.random() * rolesPool.length), 1)[0];
      p.role = role || ROLES.VILLAGER;
    });

    game.startedAt = Date.now();
    gameManager.logAction(game, 'Partie demarree (debug)');
    for (const p of game.players) {
      gameManager.logAction(game, `${p.username} => ${p.role}`);
    }

    const setupSuccess = await gameManager.postStartGame(interaction.guild, game, interaction.client);

    if (!setupSuccess) {
      await interaction.editReply("❌ Erreur lors de setupChannels");
      return;
    }

    await interaction.editReply("🌙 Jeu lancé en debug !");
  }
};
