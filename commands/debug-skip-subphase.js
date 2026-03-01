const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-skip-subphase")
    .setDescription("🐛 [DEBUG] Sauter à une sous-phase (ou la suivante)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName("subphase")
        .setDescription("Sous-phase cible (vide = suivante automatiquement)")
        .setRequired(false)
        .addChoices(
          { name: "Voleur",          value: PHASES.VOLEUR },
          { name: "Cupidon",         value: PHASES.CUPIDON },
          { name: "Salvateur",       value: PHASES.SALVATEUR },
          { name: "Loups",           value: PHASES.LOUPS },
          { name: "Loup Blanc",      value: PHASES.LOUP_BLANC },
          { name: "Sorcière",        value: PHASES.SORCIERE },
          { name: "Voyante",         value: PHASES.VOYANTE },
          { name: "Réveil",          value: PHASES.REVEIL },
          { name: "Vote Capitaine",  value: PHASES.VOTE_CAPITAINE },
          { name: "Délibération",    value: PHASES.DELIBERATION },
          { name: "Vote",            value: PHASES.VOTE },
        )
    ),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (game.phase === PHASES.ENDED) {
      await interaction.reply({ content: t('error.game_ended'), flags: MessageFlags.Ephemeral });
      return;
    }

    const targetSubPhase = interaction.options.getString("subphase");
    const previousSubPhase = game.subPhase;

    // ── No argument: auto-advance to next sub-phase ──
    if (!targetSubPhase) {
      const { safeDefer } = require('../utils/interaction');
      await safeDefer(interaction);

      gameManager.clearNightAfkTimeout(game);
      await gameManager.advanceSubPhase(interaction.guild, game);

      await interaction.editReply({
        content: t('cmd.debug_skip_subphase.auto_advance', {
          from: previousSubPhase || '—',
          to: game.subPhase,
          phase: game.phase,
        }),
      });
      return;
    }

    // ── Explicit target sub-phase ──
    if (targetSubPhase === previousSubPhase) {
      await interaction.reply({
        content: t('cmd.debug_skip_subphase.already_there', { subPhase: targetSubPhase }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { safeDefer } = require('../utils/interaction');
    await safeDefer(interaction);

    // Determine whether target is a night or day sub-phase and switch main phase if needed
    const NIGHT_SUBPHASES = [
      PHASES.VOLEUR, PHASES.CUPIDON, PHASES.SALVATEUR,
      PHASES.LOUPS, PHASES.LOUP_BLANC, PHASES.SORCIERE, PHASES.VOYANTE,
    ];
    const DAY_SUBPHASES = [
      PHASES.REVEIL, PHASES.VOTE_CAPITAINE, PHASES.DELIBERATION, PHASES.VOTE,
    ];

    const targetIsNight = NIGHT_SUBPHASES.includes(targetSubPhase);
    const targetIsDay = DAY_SUBPHASES.includes(targetSubPhase);

    // Force-set the main phase to match the target sub-phase
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      if (targetIsNight && state.phase !== PHASES.NIGHT) {
        state.phase = PHASES.NIGHT;
      } else if (targetIsDay && state.phase !== PHASES.DAY) {
        state.phase = PHASES.DAY;
      }

      // Clear any pending AFK timeout
      gameManager.clearNightAfkTimeout(state);

      // Reset sub-phase specific state when jumping to Loups
      if (targetSubPhase === PHASES.LOUPS) {
        const { createWolvesVoteState } = require('../game/wolfVoteEngine');
        state.wolvesVoteState = createWolvesVoteState();
      }

      state.subPhase = targetSubPhase;
    });

    // Refresh GUI panels so they reflect the new sub-phase
    try {
      await gameManager._refreshAllGui(game.mainChannelId);
    } catch (_) { /* best effort */ }

    // Start AFK timeout for the new sub-phase if it's a night action phase
    if (targetIsNight) {
      gameManager.startNightAfkTimeout(interaction.guild, game);
    }

    await interaction.editReply({
      content: t('cmd.debug_skip_subphase.success', {
        from: previousSubPhase || '—',
        to: targetSubPhase,
        phase: game.phase,
      }),
    });
  }
};
