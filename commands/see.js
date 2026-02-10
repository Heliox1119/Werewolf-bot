const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("see")
    .setDescription("Voyante : découvrir le rôle d'un joueur")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("Le joueur à espionner")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await interaction.reply({ content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: 64 });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérifier que c'est le channel de la voyante
    if (interaction.channelId !== game.seerChannelId) {
      await interaction.reply({ content: "❌ Cette commande ne peut être utilisée que dans le channel de la voyante", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la voyante
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.SEER) {
      await interaction.reply({ content: "❌ Tu n'es pas la voyante", flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await interaction.reply({ content: "❌ Joueur non trouvé", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply(`🔮 **${target.username}** est un **${targetPlayer.role}**`);
    gameManager.logAction(game, `Voyante regarde ${target.username} (${targetPlayer.role})`);

    if (game.phase === PHASES.NIGHT) {
      await gameManager.transitionToDay(interaction.guild, game);
    }
  }
};
