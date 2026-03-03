/**
 * game/narrationPools.js — Dynamic immersive narration system.
 *
 * Provides contextual narrative text selected ONCE per phase transition.
 * The selected text is stored in game.currentNarrative and remains
 * frozen for the entire phase — no recalculation on GUI refresh.
 *
 * DESIGN RULES:
 * ❌ Never called from GUI / embed builders / refresh loops
 * ❌ Never reveals mechanical information (roles, vote counts, etc.)
 * ❌ No dynamic variable interpolation in narration text
 * ✅ Called exclusively from _setPhase (phase transition)
 * ✅ 3–4 short texts per pool, purely atmospheric
 * ✅ Context-aware tone selection (critical / tense / calm)
 */

const ROLES = require('./roles');
const logger = require('../utils/logger');

// ─── Wolf-team roles (used for context computation) ───────────────
const WOLF_ROLES = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];

// ─── Narration Pools ──────────────────────────────────────────────
//
// Structure: NARRATION[phase][tone] → string[]
// Each string is a short atmospheric line (with optional \n for strophe).
// Emoji prefix included — these are display-ready.

const NARRATION = {
  night: {
    default: [
      '🌒 La nuit enveloppe le village d\'un voile de silence…',
      '🌑 Les étoiles scintillent tandis que le village s\'endort…',
      '🌒 Un vent glacial souffle entre les maisons endormies…',
      '🌑 Le village sombre dans un sommeil agité…',
    ],
    tense: [
      '🌘 Une nuit étrangement calme… trop calme.',
      '🌒 Aucune perte la nuit dernière… mais la menace rôde toujours.',
      '🌑 Le silence est pesant.\nQuelque chose se prépare dans l\'ombre…',
      '🌘 La lune est voilée.\nLe village retient son souffle…',
    ],
    critical: [
      '🔥 L\'ombre des loups s\'étend sur les derniers survivants…',
      '🌑 La meute se rapproche…\nLe village est au bord du gouffre.',
      '🔥 La nuit pourrait être la dernière.\nChaque souffle compte.',
      '🌑 Les ténèbres gagnent du terrain…\nLe village vacille.',
    ],
  },
  day: {
    calm: [
      '☀️ Le soleil se lève sur le village.\nUne nouvelle journée commence.',
      '🌤️ Les villageois se rassemblent sur la place du village…',
      '☀️ La lumière du matin apporte un peu d\'espoir.',
      '🌤️ Les oiseaux chantent.\nMais la méfiance persiste…',
    ],
    suspicious: [
      '☀️ Les regards sont lourds de soupçons ce matin…',
      '🌤️ La tension est palpable.\nQui ment, qui dit vrai ?',
      '☀️ Le village se réveille dans la méfiance.\nChacun observe l\'autre…',
      '🌤️ Des murmures parcourent la foule.\nLe doute s\'installe…',
    ],
    critical: [
      '🔥 Il ne reste presque plus personne…\nChaque choix est décisif.',
      '☀️ Le village est au bord de l\'extinction.\nLe dernier débat commence.',
      '🔥 Deux camps, quelques survivants.\nLe destin du village se joue maintenant.',
      '☀️ L\'heure est grave.\nUn mauvais choix et tout est perdu…',
    ],
  },
};

// ─── Context computation ──────────────────────────────────────────

/**
 * Build the narrative context from game state.
 * Pure function — no side effects.
 *
 * @param {object} game  Game state (read-only)
 * @returns {{ wolvesAlive: number, villagersAlive: number, totalAlive: number, lastNightDeaths: number }}
 */
function buildNarrativeContext(game) {
  const players = game.players || [];
  const alive = players.filter(p => p.alive);
  const wolvesAlive = alive.filter(p => WOLF_ROLES.includes(p.role)).length;
  const villagersAlive = alive.length - wolvesAlive;
  const totalAlive = alive.length;
  const dead = players.filter(p => !p.alive);
  // lastNightDeaths: count players who died (total dead minus what we had before)
  // Simple heuristic: use game._lastNightDeathCount if set, else 0
  const lastNightDeaths = game._lastNightDeathCount || 0;

  return { wolvesAlive, villagersAlive, totalAlive, lastNightDeaths };
}

// ─── Tone selection ───────────────────────────────────────────────

/**
 * Select the narrative tone for the NIGHT phase.
 * @param {{ wolvesAlive: number, villagersAlive: number, lastNightDeaths: number }} ctx
 * @returns {'default' | 'tense' | 'critical'}
 */
function selectNightTone(ctx) {
  if (ctx.wolvesAlive >= ctx.villagersAlive) return 'critical';
  if (ctx.lastNightDeaths === 0) return 'tense';
  return 'default';
}

/**
 * Select the narrative tone for the DAY phase.
 * @param {{ totalAlive: number, wolvesAlive: number, villagersAlive: number }} ctx
 * @returns {'calm' | 'suspicious' | 'critical'}
 */
function selectDayTone(ctx) {
  if (ctx.totalAlive <= 3) return 'critical';
  // Suspicious when wolves could theoretically win next round
  if (ctx.wolvesAlive >= ctx.villagersAlive - 1) return 'suspicious';
  return 'calm';
}

// ─── Random pick (deterministic within a phase) ───────────────────

/**
 * Pick a random text from a pool.
 * @param {string[]} pool
 * @returns {string}
 */
function pickRandom(pool) {
  if (!pool || pool.length === 0) return '';
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Main API ─────────────────────────────────────────────────────

/**
 * Select the narrative for a phase transition.
 * Called ONCE per transition — result is stored in game.currentNarrative.
 *
 * @param {object} game       Game state (read-only for context)
 * @param {'Nuit' | 'Jour'}  phase  The NEW phase being entered
 * @returns {{ phase: string, text: string, tone: string, context: object }}
 */
function selectNarrative(game, phase) {
  const ctx = buildNarrativeContext(game);
  let tone, pool, phaseKey;

  if (phase === 'Nuit') {
    phaseKey = 'night';
    tone = selectNightTone(ctx);
    pool = (NARRATION.night && NARRATION.night[tone]) || NARRATION.night.default;
  } else {
    phaseKey = 'day';
    tone = selectDayTone(ctx);
    pool = (NARRATION.day && NARRATION.day[tone]) || NARRATION.day.calm;
  }

  const text = pickRandom(pool);

  logger.debug('NARRATIVE_SELECTED', {
    phase: phaseKey,
    tone,
    context: ctx,
    textPreview: text.substring(0, 60),
  });

  return {
    phase: phaseKey,
    text,
    tone,
    context: ctx,
  };
}

module.exports = {
  NARRATION,
  buildNarrativeContext,
  selectNightTone,
  selectDayTone,
  selectNarrative,
  pickRandom,
};
