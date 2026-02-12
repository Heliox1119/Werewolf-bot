const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Passer son action de nuit (Voyante, Sorcière, Cupidon)"),

  async execute(interaction) {
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici.", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: "❌ Cette commande n'est disponible que la nuit.", flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || !player.alive) {
      await safeReply(interaction, { content: "❌ Vous ne participez pas ou êtes mort.", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que le joueur a le bon rôle pour la sous-phase actuelle
    const allowedSkips = {
      [PHASES.VOYANTE]: { role: ROLES.SEER, label: "Voyante" },
      [PHASES.SORCIERE]: { role: ROLES.WITCH, label: "Sorcière" },
      [PHASES.CUPIDON]: { role: ROLES.CUPID, label: "Cupidon" },
    };

    const allowed = allowedSkips[game.subPhase];
    if (!allowed) {
      await safeReply(interaction, { content: "❌ Impossible de passer cette phase.", flags: MessageFlags.Ephemeral });
      return;
    }

    if (player.role !== allowed.role) {
      await safeReply(interaction, { content: `❌ Seul(e) le/la ${allowed.label} peut passer cette phase.`, flags: MessageFlags.Ephemeral });
      return;
    }

    // Passer l'action
    gameManager.clearNightAfkTimeout(game);
    gameManager.logAction(game, `${allowed.label} passe son action (skip)`);

    await safeReply(interaction, { content: `⏭️ Vous avez passé votre action de ${allowed.label}.`, flags: MessageFlags.Ephemeral });

    // Avancer à la sous-phase suivante
    await gameManager.advanceSubPhase(interaction.guild, game);
  },
};
