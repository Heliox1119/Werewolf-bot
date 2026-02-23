const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

// Chance que les loups soient alertés (30%)
const DETECTION_CHANCE = 0.3;

/**
 * Normalise un texte : minuscules, supprime les accents, ne garde que les lettres Unicode.
 * Ex: "Éloïse_42" → "eloise"
 */
function normalizeForHint(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '') // strip ALL combining marks (accents, zalgo, etc.)
    .replace(/[^\p{L}]/gu, ''); // ne garder que les lettres Unicode
}

/**
 * Choisit une lettre du pseudo de la Petite Fille qui est la plus ambiguë :
 * celle qui apparaît dans le plus grand nombre d'autres pseudos vivants.
 * Les accents sont normalisés (é=e, ï=i) pour maximiser l'ambiguïté.
 * Exclut les lettres déjà données comme indices.
 */
function pickSmartHint(username, game) {
  const ROLES = require("../game/roles");
  // Lettres uniques du pseudo normalisé
  const targetLetters = [...new Set(normalizeForHint(username).split(''))];

  // Exclure les indices déjà donnés
  const alreadyGiven = new Set((game.listenHintsGiven || []).map(l => l.toLowerCase()));
  const available = targetLetters.filter(l => !alreadyGiven.has(l));
  if (available.length === 0) return null;

  // Pseudos normalisés des autres joueurs vivants (hors PF elle-même)
  const otherNames = game.players
    .filter(p => p.alive && p.role !== ROLES.PETITE_FILLE)
    .map(p => normalizeForHint(p.username));

  // Pour chaque lettre dispo, compter combien d'autres pseudos la contiennent
  const scored = available.map(letter => {
    const matchCount = otherNames.filter(name => name.includes(letter)).length;
    return { letter, matchCount };
  });

  // Trier : le plus de matchs d'abord (= le plus ambigu)
  scored.sort((a, b) => b.matchCount - a.matchCount);

  // Prendre la lettre la plus ambiguë
  const chosen = scored[0].letter;
  game.listenHintsGiven = game.listenHintsGiven || [];
  game.listenHintsGiven.push(chosen);

  return chosen;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
    .setDescription("Petite Fille : espionner les loups en temps réel (DM anonymisé)")
    ,

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.guild) {
      await safeReply(interaction, { content: t('error.listen_server_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Trouver la partie associée (par channel ou par joueur)
    let game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      game = Array.from(gameManager.games.values()).find(g => g.players.some(p => p.id === interaction.user.id));
    }
    if (!game) {
      await safeReply(interaction, { content: t('error.not_in_any_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.PETITE_FILLE) {
      await safeReply(interaction, { content: t('error.not_petite_fille'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: t('error.dead_cannot_listen'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier perte de pouvoirs (Ancien tué par le village)
    if (game.villageRolesPowerless) {
      await safeReply(interaction, { content: t('error.powers_lost'), flags: MessageFlags.Ephemeral });
      return;
    }

    // La Petite Fille ne peut espionner que pendant la sous-phase des loups
    const PHASES = require('../game/phases');
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.listen_night_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: t('error.wolves_not_deliberating'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.wolvesChannelId) {
      await safeReply(interaction, { content: t('error.wolves_channel_missing'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Déjà en écoute ?
    if (game.listenRelayUserId === interaction.user.id) {
      await safeReply(interaction, { content: t('error.already_listening'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      // Activer le relais temps réel
      game.listenRelayUserId = interaction.user.id;

      // Envoyer un DM de confirmation à la Petite Fille
      await interaction.user.send(t('cmd.listen.relay_started'));
      await safeReply(interaction, { content: t('cmd.listen.relay_active'), flags: MessageFlags.Ephemeral });

      // Chance de détection par les loups
      if (Math.random() < DETECTION_CHANCE) {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        if (wolvesChannel) {
          // Indice intelligent : lettre du pseudo qui apparaît dans le plus d'autres pseudos
          const hintLetter = pickSmartHint(player.username, game);
          if (hintLetter) {
            await wolvesChannel.send(t('cmd.listen.wolves_alert', { letter: hintLetter.toUpperCase() }));
          } else {
            // Plus d'indices dispo : alerte sans lettre
            await wolvesChannel.send(t('cmd.listen.wolves_alert_no_hint'));
          }
        }
      }

      // Log l'action
      gameManager.logAction(game, `Petite Fille ${player.username} espionne les loups`);

    } catch (err) {
      logger.error("Erreur /listen:", { error: err.message });
      game.listenRelayUserId = null;
      await safeReply(interaction, { content: t('error.listen_fetch_error'), flags: MessageFlags.Ephemeral });
    }
  }
};
