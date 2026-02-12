const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");

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
    if (!await isInGameCategory(interaction)) {
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

    // Vérifier que c'est la nuit ET la sous-phase de la sorcière
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: "❌ La sorcière ne peut utiliser ses potions que la nuit !", flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.SORCIERE) {
      await safeReply(interaction, { content: "❌ Ce n'est pas le tour de la sorcière", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la sorcière vivante
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.WITCH) {
      await safeReply(interaction, { content: "❌ Tu n'es pas la sorcière", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: "❌ Tu es morte", flags: MessageFlags.Ephemeral });
      return;
    }

    gameManager.clearNightAfkTimeout(game);
    const type = interaction.options.getString("type");

    if (type === "life") {
      if (!game.witchPotions.life) {
        await safeReply(interaction, { content: "❌ Tu n'as plus de potion de vie", flags: MessageFlags.Ephemeral });
        return;
      }

      if (!game.nightVictim) {
        await safeReply(interaction, { content: "❌ Personne n'a été attaqué cette nuit. Potion inutile.", flags: MessageFlags.Ephemeral });
        return;
      }

      const victimPlayer = game.players.find(p => p.id === game.nightVictim);
      const victimName = victimPlayer ? victimPlayer.username : 'quelqu\'un';

      game.witchPotions.life = false;
      game.witchSave = true;
      try { gameManager.db.useWitchPotion(game.mainChannelId, 'life'); } catch (e) { /* ignore */ }
      gameManager.logAction(game, `Sorciere utilise potion de vie pour sauver ${victimName}`);
      try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'save', interaction.user.id, game.nightVictim); } catch (e) { /* ignore */ }
      await safeReply(interaction, { content: `✅ Potion de vie utilisée ! **${victimName}** sera sauvé(e) à l'aube.`, flags: MessageFlags.Ephemeral });
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

      if (target.id === interaction.user.id) {
        await safeReply(interaction, { content: "❌ Tu ne peux pas t'empoisonner toi-même !", flags: MessageFlags.Ephemeral });
        return;
      }

      game.witchPotions.death = false;
      game.witchKillTarget = target.id;
      try { gameManager.db.useWitchPotion(game.mainChannelId, 'death'); } catch (e) { /* ignore */ }
      gameManager.logAction(game, `Sorciere empoisonne: ${target.username}`);
      try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'poison', interaction.user.id, target.id); } catch (e) { /* ignore */ }
      await safeReply(interaction, { content: `✅ **${target.username}** sera empoisonné à l'aube !`, flags: MessageFlags.Ephemeral });
    }

    if (game.phase === PHASES.NIGHT) {
      if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
        game.subPhase = PHASES.VOYANTE;
        await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
        gameManager.startNightAfkTimeout(interaction.guild, game);
      } else {
        await gameManager.transitionToDay(interaction.guild, game);
      }
    }
  }
};
