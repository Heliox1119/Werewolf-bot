const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kill")
    .setDescription("Loups-garous : choisir une victime")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La victime")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le channel des loups
    if (interaction.channelId !== game.wolvesChannelId) {
      await safeReply(interaction, { content: "❌ Cette commande ne peut être utilisée que dans le channel des loups", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est un loup
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.WEREWOLF) {
      await safeReply(interaction, { content: "❌ Tu n'es pas un loup-garou", flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: "❌ Joueur non trouvé", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: "❌ Ce joueur est déjà mort", flags: MessageFlags.Ephemeral });
      return;
    }

    game.nightVictim = target.id;
    gameManager.logAction(game, `Loups choisissent: ${target.username}`);
    await safeReply(interaction, { content: `✅ ${target.username} a été choisi pour cette nuit.`, flags: MessageFlags.Ephemeral });

    // Auto-chain to next night role or day
    if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
      game.subPhase = PHASES.SORCIERE;
      await gameManager.announcePhase(interaction.guild, game, "La sorcière se réveille...");
      return;
    }

    if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
      game.subPhase = PHASES.VOYANTE;
      await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
      return;
    }

    await gameManager.transitionToDay(interaction.guild, game);
  }
};
