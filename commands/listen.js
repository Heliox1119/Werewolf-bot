const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
    .setDescription("Petite Fille : espionner les loups (utilisez le bouton sur le panneau du village)")
    ,

  async execute(interaction) {
    // Legacy command — replaced by the village panel button (lgirl_listen).
    await safeReply(interaction, {
      content: t('error.listen_use_button') || "❌ La commande `/listen` a été remplacée. Utilise le bouton 👂 *Écouter les Loups* sur le panneau du village pendant la phase des loups.",
      flags: MessageFlags.Ephemeral,
    });
  }
};
