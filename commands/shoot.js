const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shoot")
    .setDescription("Chasseur : tirer sur un joueur en mourant")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("Le joueur à abattre")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est bien le chasseur
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.HUNTER) {
      await safeReply(interaction, { content: "❌ Tu n'es pas le chasseur", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que le chasseur DOIT tirer (il est mort et n'a pas encore tiré)
    if (game._hunterMustShoot !== interaction.user.id) {
      await safeReply(interaction, { content: "❌ Tu ne peux tirer que lorsque tu meurs", flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: "❌ Joueur non trouvé dans la partie", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: "❌ Ce joueur est déjà mort", flags: MessageFlags.Ephemeral });
      return;
    }

    // Ne peut pas se tirer soi-même (il est déjà mort de toute façon)
    if (target.id === interaction.user.id) {
      await safeReply(interaction, { content: "❌ Tu ne peux pas te tirer toi-même", flags: MessageFlags.Ephemeral });
      return;
    }

    // Effacer le flag et le timer
    game._hunterMustShoot = null;
    if (game._hunterTimer) {
      clearTimeout(game._hunterTimer);
      game._hunterTimer = null;
    }

    // Tuer la cible
    const collateral = gameManager.kill(game.mainChannelId, target.id);
    gameManager.logAction(game, `Chasseur tire sur: ${target.username}`);
    try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'shoot', interaction.user.id, target.id); } catch (e) { /* ignore */ }

    const mainChannel = game.villageChannelId
      ? await interaction.guild.channels.fetch(game.villageChannelId)
      : await interaction.guild.channels.fetch(game.mainChannelId);

    await gameManager.sendLogged(mainChannel, `🏹 **${player.username}** le Chasseur a tiré sur **${target.username}** en mourant !`, { type: 'hunterShoot' });

    // Annoncer les morts collatérales (amoureux)
    for (const dead of collateral) {
      await gameManager.sendLogged(mainChannel, `💔 **${dead.username}** meurt de chagrin... (amoureux)`, { type: 'loverDeath' });
      gameManager.logAction(game, `Mort d'amour: ${dead.username}`);
    }

    await safeReply(interaction, { content: `✅ Tu as tiré sur **${target.username}** !`, flags: MessageFlags.Ephemeral });

    // Vérifier si la cible du chasseur était aussi un chasseur (edge case improbable mais sécurisé)
    // et vérifier la victoire
    await gameManager.announceVictoryIfAny(interaction.guild, game);
  }
};
