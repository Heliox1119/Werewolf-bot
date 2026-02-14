const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t, translatePhase } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Voir l'état de la partie"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
    const alive = game.players.filter(p => p.alive);
    const dead = game.players.filter(p => !p.alive);
    let message = t('status.title') + `\n\n`;
    message += t('status.phase', { phase: translatePhase(game.phase) }) + `\n`;
    message += t('status.alive', { n: alive.length }) + `\n`;
    message += t('status.dead', { n: dead.length }) + `\n`;
    if (game.captainId) {
      const cap = game.players.find(p => p.id === game.captainId);
      if (cap) message += `\n` + t('status.captain', { name: cap.username }) + `\n`;
    }
    message += `\n`;
    if (alive.length > 0) {
      message += t('status.alive_list') + `\n${alive.map(p => `  • ${p.username}`).join("\n")}\n\n`;
    }
    if (dead.length > 0) {
      message += t('status.dead_list') + `\n${dead.map(p => `  • ${p.username}`).join("\n")}`;
    }
    const victory = gameManager.checkVictory(interaction.channelId);
    if (victory) {
      message += `\n\n` + t('status.victory', { name: victory });
    }
    await safeReply(interaction, { content: message });
  }
};
