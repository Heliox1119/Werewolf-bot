/**
 * Ability Schema — Strict JSON schema for composable role abilities.
 * 
 * All abilities must conform to this schema. No dynamic code execution.
 * No eval. No free-text effects. Everything is whitelisted.
 * 
 * @module game/abilities/abilitySchema
 */

'use strict';

// ─── Whitelisted Enums ───────────────────────────────────────────────────────

const ABILITY_TYPES = Object.freeze([
  'night_target',      // Active ability used at night targeting a player
  'passive',           // Always-on effect, no targeting required
  'on_death',          // Triggers when the role holder dies
  'on_attacked',       // Triggers when the role holder is targeted by an attack
  'on_vote',           // Triggers during village vote phase
  'on_phase_start',    // Triggers at the start of a specific phase
  'on_phase_end',      // Triggers at the end of a specific phase
]);

const ABILITY_EFFECTS = Object.freeze([
  'protect',            // Shield a player from death this turn
  'kill',               // Kill a targeted player
  'inspect_alignment',  // Reveal camp (village/wolves/solo)
  'inspect_role',       // Reveal exact role
  'double_vote',        // Vote counts as 2
  'silence',            // Prevent target from using chat next phase
  'redirect',           // Redirect actions targeting X to Y
  'block',              // Prevent target from using their ability
  'reveal_role',        // Publicly reveal a player's role
  'reveal_alignment',   // Publicly reveal a player's camp
  'modify_vote_weight', // Adjust vote power (captain-like)
  'swap_roles',         // Exchange roles between two players
  'immune_to_kill',     // Cannot be killed (passive)
  'win_override',       // Special win condition check
]);

const ABILITY_TRIGGERS = Object.freeze([
  'night_action',       // During normal night action window
  'player_targeted',    // When this player is targeted by an action
  'vote_cast',          // When a vote is cast
  'player_death',       // When a player dies
  'phase_start',        // When a phase begins
  'phase_end',          // When a phase ends
]);

const CAMP_VALUES = Object.freeze([
  'village',
  'wolves',
  'solo',
]);

const WIN_CONDITIONS = Object.freeze([
  'village_wins',       // Win with village
  'wolves_win',         // Win with wolves
  'solo_survive',       // Win if alive at end
  'lovers_survive',     // Win if both lovers alive and game ends
]);

const TARGET_TYPES = Object.freeze([
  'alive_player',       // Any alive player
  'alive_other',        // Any alive player except self
  'alive_non_wolf',     // Alive non-wolf player
  'alive_wolf',         // Alive wolf player
  'self',               // Self only
  'none',               // No target needed (passive/auto)
]);

const PHASE_VALUES = Object.freeze([
  'night',
  'day',
  'any',
]);

// ─── Ability Definition ──────────────────────────────────────────────────────

/**
 * @typedef {Object} AbilityDefinition
 * @property {string} id           - Unique ability identifier within the role
 * @property {string} type         - One of ABILITY_TYPES
 * @property {string} trigger      - One of ABILITY_TRIGGERS
 * @property {string|null} phase   - One of PHASE_VALUES or null
 * @property {string|null} target  - One of TARGET_TYPES or null
 * @property {string} effect       - One of ABILITY_EFFECTS
 * @property {number|null} charges - Number of uses (null = unlimited)
 * @property {number|null} cooldown - Turns between uses (null = no cooldown)
 * @property {number} priority     - Execution priority (lower = earlier)
 * @property {Object} parameters   - Effect-specific parameters (validated)
 */

// ─── Priority Constants ──────────────────────────────────────────────────────

const EFFECT_PRIORITY = Object.freeze({
  redirect:           10,
  block:              20,
  protect:            30,
  immune_to_kill:     35,
  kill:               40,
  inspect_alignment:  50,
  inspect_role:       50,
  reveal_role:        55,
  reveal_alignment:   55,
  silence:            60,
  double_vote:        70,
  modify_vote_weight: 70,
  swap_roles:         80,
  win_override:       90,
});

// ─── Parameter Schemas per Effect ────────────────────────────────────────────

const EFFECT_PARAMETER_SCHEMAS = Object.freeze({
  protect:            { optional: ['protectSelf'] },
  kill:               { optional: ['bypassProtection'] },
  inspect_alignment:  { optional: [] },
  inspect_role:       { optional: [] },
  double_vote:        { optional: [] },
  silence:            { optional: ['duration'] },
  redirect:           { required: [], optional: [] },
  block:              { optional: ['duration'] },
  reveal_role:        { optional: ['toAll'] },
  reveal_alignment:   { optional: ['toAll'] },
  modify_vote_weight: { required: ['weight'] },
  swap_roles:         { optional: [] },
  immune_to_kill:     { optional: ['maxUses'] },
  win_override:       { required: ['condition'] },
});

// ─── Forbidden Combinations ──────────────────────────────────────────────────

/**
 * Ability effect combinations that are forbidden to prevent broken gameplay.
 * Each entry is [effectA, effectB] — having both on one role is rejected.
 */
const FORBIDDEN_COMBOS = Object.freeze([
  ['kill', 'immune_to_kill'],           // Unkillable killer is OP
  ['win_override', 'immune_to_kill'],   // Guaranteed solo win
  ['swap_roles', 'win_override'],       // Role-swap + custom win = exploitable
]);

// Maximum abilities per role
const MAX_ABILITIES_PER_ROLE = 5;

// Maximum recursion depth for event chains
const MAX_EVENT_DEPTH = 3;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a single ability definition.
 * @param {Object} ability - Raw ability object
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateAbility(ability) {
  const errors = [];

  if (!ability || typeof ability !== 'object') {
    return { valid: false, errors: ['Ability must be an object'] };
  }

  // id
  if (typeof ability.id !== 'string' || ability.id.length < 1 || ability.id.length > 64) {
    errors.push('Ability id must be a string (1–64 chars)');
  }
  if (ability.id && !/^[a-z0-9_]+$/.test(ability.id)) {
    errors.push('Ability id must be lowercase alphanumeric with underscores only');
  }

  // type
  if (!ABILITY_TYPES.includes(ability.type)) {
    errors.push(`Invalid ability type: ${ability.type}. Allowed: ${ABILITY_TYPES.join(', ')}`);
  }

  // trigger
  if (!ABILITY_TRIGGERS.includes(ability.trigger)) {
    errors.push(`Invalid trigger: ${ability.trigger}. Allowed: ${ABILITY_TRIGGERS.join(', ')}`);
  }

  // phase
  if (ability.phase !== null && ability.phase !== undefined && !PHASE_VALUES.includes(ability.phase)) {
    errors.push(`Invalid phase: ${ability.phase}. Allowed: ${PHASE_VALUES.join(', ')}, or null`);
  }

  // target
  if (ability.target !== null && ability.target !== undefined && !TARGET_TYPES.includes(ability.target)) {
    errors.push(`Invalid target: ${ability.target}. Allowed: ${TARGET_TYPES.join(', ')}, or null`);
  }

  // effect
  if (!ABILITY_EFFECTS.includes(ability.effect)) {
    errors.push(`Invalid effect: ${ability.effect}. Allowed: ${ABILITY_EFFECTS.join(', ')}`);
  }

  // charges
  if (ability.charges !== null && ability.charges !== undefined) {
    if (!Number.isInteger(ability.charges) || ability.charges < 1 || ability.charges > 99) {
      errors.push('Charges must be an integer between 1 and 99, or null');
    }
  }

  // cooldown
  if (ability.cooldown !== null && ability.cooldown !== undefined) {
    if (!Number.isInteger(ability.cooldown) || ability.cooldown < 1 || ability.cooldown > 10) {
      errors.push('Cooldown must be an integer between 1 and 10, or null');
    }
  }

  // priority — auto-assigned from effect if missing, but validate if present
  if (ability.priority !== undefined && ability.priority !== null) {
    if (!Number.isInteger(ability.priority) || ability.priority < 0 || ability.priority > 100) {
      errors.push('Priority must be an integer between 0 and 100');
    }
  }

  // parameters
  if (ability.parameters !== undefined && ability.parameters !== null) {
    if (typeof ability.parameters !== 'object' || Array.isArray(ability.parameters)) {
      errors.push('Parameters must be a plain object');
    } else {
      const paramErrors = validateParameters(ability.effect, ability.parameters);
      errors.push(...paramErrors);
    }
  }

  // Type-trigger consistency checks
  if (ability.type === 'night_target' && ability.trigger !== 'night_action') {
    errors.push('night_target abilities must have trigger: night_action');
  }
  if (ability.type === 'on_death' && ability.trigger !== 'player_death') {
    errors.push('on_death abilities must have trigger: player_death');
  }
  if (ability.type === 'on_attacked' && ability.trigger !== 'player_targeted') {
    errors.push('on_attacked abilities must have trigger: player_targeted');
  }
  if (ability.type === 'passive' && !['phase_start', 'phase_end', 'player_targeted'].includes(ability.trigger)) {
    errors.push('passive abilities must have trigger: phase_start, phase_end, or player_targeted');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate effect-specific parameters.
 * @param {string} effect
 * @param {Object} params
 * @returns {string[]} errors
 */
function validateParameters(effect, params) {
  const errors = [];
  const schema = EFFECT_PARAMETER_SCHEMAS[effect];
  if (!schema) return errors;

  // Check required params
  if (schema.required) {
    for (const key of schema.required) {
      if (params[key] === undefined || params[key] === null) {
        errors.push(`Missing required parameter '${key}' for effect '${effect}'`);
      }
    }
  }

  // Check no unknown params
  const allowed = new Set([...(schema.required || []), ...(schema.optional || [])]);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) {
      errors.push(`Unknown parameter '${key}' for effect '${effect}'`);
    }
  }

  // Specific value validations
  if (effect === 'modify_vote_weight' && params.weight !== undefined) {
    if (typeof params.weight !== 'number' || params.weight < 0 || params.weight > 5) {
      errors.push('modify_vote_weight.weight must be a number between 0 and 5');
    }
  }

  if (effect === 'win_override' && params.condition !== undefined) {
    if (!WIN_CONDITIONS.includes(params.condition)) {
      errors.push(`Invalid win condition: ${params.condition}`);
    }
  }

  if (params.duration !== undefined) {
    if (!Number.isInteger(params.duration) || params.duration < 1 || params.duration > 5) {
      errors.push('duration must be an integer between 1 and 5');
    }
  }

  if (params.protectSelf !== undefined && typeof params.protectSelf !== 'boolean') {
    errors.push('protectSelf must be a boolean');
  }

  if (params.bypassProtection !== undefined && typeof params.bypassProtection !== 'boolean') {
    errors.push('bypassProtection must be a boolean');
  }

  if (params.toAll !== undefined && typeof params.toAll !== 'boolean') {
    errors.push('toAll must be a boolean');
  }

  if (params.maxUses !== undefined) {
    if (!Number.isInteger(params.maxUses) || params.maxUses < 1 || params.maxUses > 10) {
      errors.push('maxUses must be an integer between 1 and 10');
    }
  }

  return errors;
}

/**
 * Validate a complete custom role definition.
 * @param {Object} role - { id, name, camp, winCondition, abilities }
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRoleDefinition(role) {
  const errors = [];

  if (!role || typeof role !== 'object') {
    return { valid: false, errors: ['Role definition must be an object'] };
  }

  // name
  if (typeof role.name !== 'string' || role.name.length < 1 || role.name.length > 50) {
    errors.push('Role name must be a string (1–50 chars)');
  }

  // camp
  if (!CAMP_VALUES.includes(role.camp)) {
    errors.push(`Invalid camp: ${role.camp}. Allowed: ${CAMP_VALUES.join(', ')}`);
  }

  // winCondition
  if (!WIN_CONDITIONS.includes(role.winCondition)) {
    errors.push(`Invalid winCondition: ${role.winCondition}. Allowed: ${WIN_CONDITIONS.join(', ')}`);
  }

  // Camp–winCondition compatibility
  if (role.camp === 'village' && role.winCondition === 'wolves_win') {
    errors.push('Village camp cannot have wolves_win condition');
  }
  if (role.camp === 'wolves' && role.winCondition === 'village_wins') {
    errors.push('Wolves camp cannot have village_wins condition');
  }

  // abilities
  if (!Array.isArray(role.abilities)) {
    errors.push('abilities must be an array');
    return { valid: false, errors };
  }

  if (role.abilities.length > MAX_ABILITIES_PER_ROLE) {
    errors.push(`Maximum ${MAX_ABILITIES_PER_ROLE} abilities per role`);
  }

  // Check for duplicate ability IDs
  const ids = new Set();
  for (const ability of role.abilities) {
    if (ability && ability.id) {
      if (ids.has(ability.id)) {
        errors.push(`Duplicate ability id: ${ability.id}`);
      }
      ids.add(ability.id);
    }
  }

  // Validate each ability
  for (let i = 0; i < role.abilities.length; i++) {
    const result = validateAbility(role.abilities[i]);
    if (!result.valid) {
      for (const err of result.errors) {
        errors.push(`abilities[${i}]: ${err}`);
      }
    }
  }

  // Check forbidden combos
  const effects = role.abilities.map(a => a.effect).filter(Boolean);
  for (const [a, b] of FORBIDDEN_COMBOS) {
    if (effects.includes(a) && effects.includes(b)) {
      errors.push(`Forbidden ability combination: ${a} + ${b}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalize an ability definition — fill in defaults.
 * Call AFTER validation passes.
 * @param {Object} ability - Validated ability
 * @returns {Object} Normalized ability (new object)
 */
function normalizeAbility(ability) {
  return {
    id: ability.id,
    type: ability.type,
    trigger: ability.trigger,
    phase: ability.phase || null,
    target: ability.target || null,
    effect: ability.effect,
    charges: ability.charges ?? null,
    cooldown: ability.cooldown ?? null,
    priority: ability.priority ?? EFFECT_PRIORITY[ability.effect] ?? 50,
    parameters: ability.parameters ? { ...ability.parameters } : {},
  };
}

/**
 * Normalize a complete role definition.
 * @param {Object} role
 * @returns {Object}
 */
function normalizeRoleDefinition(role) {
  return {
    name: role.name.trim(),
    camp: role.camp,
    winCondition: role.winCondition,
    abilities: role.abilities.map(normalizeAbility),
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  ABILITY_TYPES,
  ABILITY_EFFECTS,
  ABILITY_TRIGGERS,
  CAMP_VALUES,
  WIN_CONDITIONS,
  TARGET_TYPES,
  PHASE_VALUES,
  EFFECT_PRIORITY,
  EFFECT_PARAMETER_SCHEMAS,
  FORBIDDEN_COMBOS,
  MAX_ABILITIES_PER_ROLE,
  MAX_EVENT_DEPTH,
  validateAbility,
  validateParameters,
  validateRoleDefinition,
  normalizeAbility,
  normalizeRoleDefinition,
};
