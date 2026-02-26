/**
 * ═══════════════════════════════════════════════════════════════════
 * Strategic Role Analysis Engine
 * ═══════════════════════════════════════════════════════════════════
 *
 * Pure, deterministic scoring engine for Werewolf custom roles.
 * Computes power rating, strategic orientation, and stability risk.
 *
 * No side effects. No DOM. No async. Fully reproducible.
 *
 * Usage (browser):  window.StrategicEngine.analyze(abilities)
 * Usage (Node):     const engine = require('./strategicEngine'); engine.analyze(abilities)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.StrategicEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ─── Base Power Weights Per Effect ───────────────────────────────────────────
  // Scale: 0–6 raw points per ability (before modifiers)
  const EFFECT_WEIGHTS = Object.freeze({
    kill:               5.0,
    win_override:       4.5,
    redirect:           4.0,
    immune_to_kill:     4.0,
    swap_roles:         3.8,
    inspect_role:       3.0,
    block:              3.0,
    silence:            3.0,
    reveal_role:        2.8,
    inspect_alignment:  2.5,
    reveal_alignment:   2.2,
    protect:            2.0,
    double_vote:        2.0,
    modify_vote_weight: 2.0,
  });

  // ─── Modifier Rules ──────────────────────────────────────────────────────────
  // Applied after base weight to adjust ability power contextually

  function computeModifiers(ability) {
    let mod = 0;

    // Passive abilities are always-on → stronger
    if (ability.type === 'passive') mod += 1.5;

    // Unlimited charges → stronger
    if (ability.charges === null || ability.charges === undefined) mod += 0.8;

    // Very limited charges (1 use) → weaker
    if (ability.charges !== null && ability.charges !== undefined && ability.charges <= 1) mod -= 1.0;

    // No cooldown with unlimited = always available → stronger
    if ((ability.cooldown === null || ability.cooldown === undefined) &&
        (ability.charges === null || ability.charges === undefined)) {
      mod += 0.5;
    }

    // High cooldown → weaker
    if (ability.cooldown !== null && ability.cooldown !== undefined && ability.cooldown >= 3) {
      mod -= 0.5;
    }

    // Parameter-based modifiers
    if (ability.parameters) {
      if (ability.parameters.bypassProtection === true) mod += 1.5;
      if (ability.parameters.protectSelf === true) mod += 0.5;
      if (ability.parameters.toAll === true) mod += 0.8;
    }

    return mod;
  }

  // ─── Orientation Classification ──────────────────────────────────────────────
  // Each effect contributes to 1+ orientation axes

  const ORIENTATION_AXES = Object.freeze({
    aggressive: new Set(['kill', 'silence', 'block']),
    defensive:  new Set(['protect', 'immune_to_kill', 'redirect']),
    information: new Set(['inspect_alignment', 'inspect_role', 'reveal_role', 'reveal_alignment']),
    control:    new Set(['modify_vote_weight', 'double_vote', 'silence', 'block']),
    chaos:      new Set(['swap_roles', 'redirect', 'win_override']),
  });

  const ORIENTATION_LABELS = Object.freeze({
    aggressive:  { label: 'Offensif',      icon: '⚔️',  color: '#ef4444' },
    defensive:   { label: 'Défensif',      icon: '🛡️',  color: '#3b82f6' },
    information: { label: 'Information',   icon: '🔍',  color: '#8b5cf6' },
    control:     { label: 'Contrôle',      icon: '⚖️',  color: '#f59e0b' },
    chaos:       { label: 'Chaos',         icon: '🌀',  color: '#ec4899' },
    hybrid:      { label: 'Hybride',       icon: '🔮',  color: '#6366f1' },
    support:     { label: 'Support',       icon: '💚',  color: '#10b981' },
    none:        { label: 'Non défini',    icon: '—',   color: '#6b7280' },
  });

  /**
   * Compute orientation scores for a set of abilities.
   * Returns { dominant, scores: { aggressive, defensive, information, control, chaos } }
   */
  function computeOrientation(abilities) {
    const scores = {
      aggressive: 0,
      defensive: 0,
      information: 0,
      control: 0,
      chaos: 0,
    };

    if (!abilities || abilities.length === 0) {
      return { dominant: 'none', scores, meta: ORIENTATION_LABELS.none };
    }

    for (const ab of abilities) {
      const effect = ab.effect;
      if (!effect) continue;

      const weight = EFFECT_WEIGHTS[effect] || 1;

      for (const [axis, effects] of Object.entries(ORIENTATION_AXES)) {
        if (effects.has(effect)) {
          scores[axis] += weight;
        }
      }
    }

    // Find dominant axis
    const entries = Object.entries(scores).filter(([, v]) => v > 0);
    if (entries.length === 0) {
      return { dominant: 'none', scores, meta: ORIENTATION_LABELS.none };
    }

    entries.sort((a, b) => b[1] - a[1]);
    const top = entries[0];
    const second = entries[1];

    // If two axes are close (within 30% of top), classify as hybrid
    let dominant;
    if (second && second[1] > 0 && (second[1] / top[1]) >= 0.7) {
      dominant = 'hybrid';
    } else {
      dominant = top[0];
    }

    // Special case: protect-heavy + no aggression = support
    if ((dominant === 'defensive' || dominant === 'hybrid') && scores.aggressive === 0 &&
        abilities.some(a => a.effect === 'protect' || a.effect === 'double_vote')) {
      dominant = 'support';
    }

    return {
      dominant,
      scores,
      meta: ORIENTATION_LABELS[dominant] || ORIENTATION_LABELS.none,
    };
  }

  // ─── Power Score ─────────────────────────────────────────────────────────────

  /**
   * Compute a power score (0–10) for a set of abilities.
   * @param {Array} abilities - Array of ability objects
   * @returns {{ score: number, breakdown: Array, tier: string }}
   */
  function computePower(abilities) {
    if (!abilities || abilities.length === 0) {
      return { score: 0, breakdown: [], tier: 'N/A' };
    }

    let raw = 0;
    const breakdown = [];

    for (const ab of abilities) {
      const base = EFFECT_WEIGHTS[ab.effect] || 0;
      const mod = computeModifiers(ab);
      const total = Math.max(0, base + mod);
      raw += total;

      breakdown.push({
        effect: ab.effect,
        base: base,
        modifier: mod,
        total: total,
      });
    }

    // Multi-ability synergy bonus
    if (abilities.length >= 2) raw += 0.5 * (abilities.length - 1);

    // Normalize to 0–10 using a soft ceiling
    // Single ability: max ~7-8, multi: can reach 10
    const maxPossible = 8 + (abilities.length * 1.5);
    const normalized = Math.min(10, (raw / maxPossible) * 10);
    const score = Math.round(normalized * 10) / 10;

    // Tier classification
    let tier;
    if (score <= 2)       tier = 'Faible';
    else if (score <= 4)  tier = 'Modéré';
    else if (score <= 6)  tier = 'Standard';
    else if (score <= 8)  tier = 'Puissant';
    else                  tier = 'Extrême';

    return { score, breakdown, tier };
  }

  // ─── Stability / Risk Analysis ───────────────────────────────────────────────

  const RISK_FLAGS = Object.freeze({
    PASSIVE_KILL:         { severity: 3, label: 'Tuer en mode passif est extrêmement puissant' },
    UNLIMITED_KILL:       { severity: 2, label: 'Pouvoir de tuer sans limite d\'utilisations' },
    BYPASS_PROTECTION:    { severity: 2, label: 'Attaque ignorant la protection' },
    MANY_ABILITIES:       { severity: 1, label: 'Nombre élevé de capacités (complexité)' },
    PASSIVE_IMMUNITY:     { severity: 2, label: 'Immunité permanente aux attaques' },
    INFINITE_REDIRECT:    { severity: 2, label: 'Redirections multiples (boucles possibles)' },
    UNCHECKED_WIN:        { severity: 2, label: 'Condition de victoire spéciale sans contrepartie' },
    NO_COOLDOWN_POWER:    { severity: 1, label: 'Pouvoir offensif sans délai de réutilisation' },
    SOLO_IMMUNE:          { severity: 2, label: 'Solo avec immunité = victoire quasi-garantie' },
  });

  /**
   * Analyze stability risks for a set of abilities.
   * @param {Array} abilities
   * @param {Object} roleContext - { camp, winCondition }
   * @returns {{ level: string, flags: Array, totalSeverity: number, color: string }}
   */
  function computeRisk(abilities, roleContext) {
    const flags = [];
    if (!abilities || abilities.length === 0) {
      return { level: 'Aucun', flags, totalSeverity: 0, color: '#6b7280' };
    }

    const effects = abilities.map(a => a.effect).filter(Boolean);
    const types = abilities.map(a => a.type).filter(Boolean);
    const camp = roleContext?.camp || 'village';
    const win = roleContext?.winCondition || '';

    // F1: Passive + kill
    if (types.includes('passive') && effects.includes('kill')) {
      flags.push(RISK_FLAGS.PASSIVE_KILL);
    }

    // F2: Unlimited kill
    const killAbilities = abilities.filter(a => a.effect === 'kill');
    if (killAbilities.some(a => a.charges === null || a.charges === undefined)) {
      flags.push(RISK_FLAGS.UNLIMITED_KILL);
    }

    // F3: Bypass protection
    if (abilities.some(a => a.parameters?.bypassProtection === true)) {
      flags.push(RISK_FLAGS.BYPASS_PROTECTION);
    }

    // F4: Too many abilities
    if (abilities.length > 3) {
      flags.push(RISK_FLAGS.MANY_ABILITIES);
    }

    // F5: Passive immunity
    if (abilities.some(a => a.effect === 'immune_to_kill' && a.type === 'passive')) {
      flags.push(RISK_FLAGS.PASSIVE_IMMUNITY);
    }

    // F6: Multiple redirects
    if (effects.filter(e => e === 'redirect').length >= 2) {
      flags.push(RISK_FLAGS.INFINITE_REDIRECT);
    }

    // F7: Win override without drawbacks
    if (effects.includes('win_override') && !effects.includes('kill') && abilities.length <= 1) {
      flags.push(RISK_FLAGS.UNCHECKED_WIN);
    }

    // F8: No cooldown on offensive powers
    const offensiveEffects = new Set(['kill', 'silence', 'block']);
    if (abilities.some(a => offensiveEffects.has(a.effect) &&
        (a.cooldown === null || a.cooldown === undefined) &&
        (a.charges === null || a.charges === undefined) &&
        a.type !== 'on_death')) {
      flags.push(RISK_FLAGS.NO_COOLDOWN_POWER);
    }

    // F9: Solo camp + immunity
    if (camp === 'solo' && effects.includes('immune_to_kill')) {
      flags.push(RISK_FLAGS.SOLO_IMMUNE);
    }

    // Compute total severity
    const totalSeverity = flags.reduce((sum, f) => sum + f.severity, 0);

    let level, color;
    if (totalSeverity === 0)      { level = 'Faible';  color = '#10b981'; }
    else if (totalSeverity <= 2)  { level = 'Modéré';  color = '#f59e0b'; }
    else if (totalSeverity <= 4)  { level = 'Élevé';   color = '#f97316'; }
    else                          { level = 'Critique'; color = '#ef4444'; }

    return { level, flags, totalSeverity, color };
  }

  // ─── Full Analysis ───────────────────────────────────────────────────────────

  /**
   * Run complete strategic analysis on a role.
   * @param {Array} abilities - Array of ability objects (backend schema format)
   * @param {Object} roleContext - { camp, winCondition }
   * @returns {{ power: Object, orientation: Object, risk: Object }}
   */
  function analyze(abilities, roleContext) {
    return {
      power:       computePower(abilities),
      orientation: computeOrientation(abilities),
      risk:        computeRisk(abilities, roleContext),
    };
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  return Object.freeze({
    analyze,
    computePower,
    computeOrientation,
    computeRisk,
    EFFECT_WEIGHTS,
    ORIENTATION_LABELS,
    RISK_FLAGS,
  });
});
