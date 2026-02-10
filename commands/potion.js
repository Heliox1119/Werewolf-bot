const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("potion")
    .setDescription("Sorcière : utiliser une potion")
    .addStringOption(option =>
      option
        .setName("type")
        .setDescription("Type de potion")
        .setRequired(true)
        .addChoices(
          { name: "Vie (sauver)", value: "life" },
          { name: "Mort (tuer)", value: "death" }
        )
    )
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La cible (obligatoire pour 'mort')")
        .setRequired(false)
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

    // Vérifier que c'est le channel de la sorcière
    if (interaction.channelId !== game.witchChannelId) {
      await safeReply(interaction, { content: "❌ Cette commande ne peut être utilisée que dans le channel de la sorcière", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la sorcière
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.WITCH) {
      await safeReply(interaction, { content: "❌ Tu n'es pas la sorcière", flags: MessageFlags.Ephemeral });
      return;
    }

    const type = interaction.options.getString("type");

    if (type === "life") {
      if (!game.witchPotions.life) {
        await safeReply(interaction, { content: "❌ Tu n'as plus de potion de vie", flags: MessageFlags.Ephemeral });
        return;
      }

      game.witchPotions.life = false;
      gameManager.logAction(game, `Sorciere utilise potion de vie`);
      await safeReply(interaction, { content: "✅ Potion de vie utilisée ! Tu sauveras la victime des loups cette nuit.", flags: MessageFlags.Ephemeral });
    } else if (type === "death") {
      if (!game.witchPotions.death) {
        await safeReply(interaction, { content: "❌ Tu n'as plus de potion de mort", flags: MessageFlags.Ephemeral });
        return;
      }

      const target = interaction.options.getUser("target");
      if (!target) {
        await safeReply(interaction, { content: "❌ Tu dois spécifier une cible pour la potion de mort", flags: MessageFlags.Ephemeral });
        return;
      }

      const targetPlayer = game.players.find(p => p.id === target.id);
      if (!targetPlayer || !targetPlayer.alive) {
        await safeReply(interaction, { content: "❌ Cible invalide", flags: MessageFlags.Ephemeral });
        return;
      }

      game.witchPotions.death = false;
      gameManager.kill(interaction.channelId, target.id);
      gameManager.logAction(game, `Sorciere empoisonne: ${target.username}`);
      await safeReply(interaction, { content: `✅ **${target.username}** a été empoisonné !`, flags: MessageFlags.Ephemeral });
    }

    if (game.phase === PHASES.NIGHT) {
      if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
        game.subPhase = PHASES.VOYANTE;
        await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
      } else {
        await gameManager.transitionToDay(interaction.guild, game);
      }
    }
  }
};
