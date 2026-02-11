const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");

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
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérifier que c'est le channel de la voyante
    if (interaction.channelId !== game.seerChannelId) {
      await safeReply(interaction, { content: "❌ Cette commande ne peut être utilisée que dans le channel de la voyante", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit ET la sous-phase de la voyante
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: "❌ La voyante ne peut utiliser son pouvoir que la nuit !", flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.VOYANTE) {
      await safeReply(interaction, { content: "❌ Ce n'est pas le tour de la voyante", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la voyante vivante
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.SEER) {
      await safeReply(interaction, { content: "❌ Tu n'es pas la voyante", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: "❌ Tu es morte, tu ne peux plus espionner", flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: "❌ Joueur non trouvé", flags: MessageFlags.Ephemeral });
      return;
    }

    gameManager.clearNightAfkTimeout(game);
    await safeReply(interaction, { content: `🔮 **${target.username}** est un **${targetPlayer.role}**`, flags: MessageFlags.Ephemeral });
    gameManager.logAction(game, `Voyante regarde ${target.username} (${targetPlayer.role})`);

    if (game.phase === PHASES.NIGHT) {
      // Passer par advanceSubPhase (VOYANTE → REVEIL → DAY)
      await gameManager.advanceSubPhase(interaction.guild, game);
      // Si on est en REVEIL, transitionner vers le jour
      if (game.subPhase === PHASES.REVEIL) {
        await gameManager.transitionToDay(interaction.guild, game);
      }
    }
  }
};
