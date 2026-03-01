/**
 * interactions/ephemeralRoleActions/index.js
 *
 * Generic router for ephemeral role-action buttons.
 *
 * These are roles that:
 *  - have NO private channel
 *  - act from the village channel via a button on the village master panel
 *  - need ALL server-side guards (phase, subPhase, role, alive, idempotence)
 *
 * Currently supported:
 *  - lgirl_listen → Little Girl eavesdrops on wolves (village panel button)
 *
 * Architecture note: adding a new ephemeral role action requires only:
 *  1. A guard in interactions/common/guards.js
 *  2. A handler in interactions/ephemeralRoleActions/<role>.js
 *  3. A customId entry in the EPHEMERAL_HANDLERS map below
 */

const { handleLittleGirlListen } = require('./littleGirlListen');

/**
 * Map of customId → handler for ephemeral role action buttons.
 * All handlers expect the interaction to be already deferred (ephemeral).
 */
const EPHEMERAL_HANDLERS = {
  lgirl_listen: handleLittleGirlListen,
};

/**
 * All known ephemeral button customIds.
 * Used by index.js routing to identify these buttons.
 */
const EPHEMERAL_BUTTON_IDS = Object.keys(EPHEMERAL_HANDLERS);

/**
 * Route an ephemeral role-action button interaction.
 * The interaction MUST already be deferred (ephemeral).
 *
 * @param {ButtonInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleEphemeralRoleButton(interaction) {
  const handler = EPHEMERAL_HANDLERS[interaction.customId];
  if (handler) {
    await handler(interaction);
  }
  // Unknown customId: silently ignore (shouldn't happen with correct routing)
}

module.exports = {
  EPHEMERAL_BUTTON_IDS,
  handleEphemeralRoleButton,
};
