/**
 * 🐺 Roles Page — Camp filtering, card flip, narrative ability builder with advanced mode
 */
(function() {
  'use strict';
  const t = (k) => (window.webI18n ? window.webI18n.t(k) : k);

  // ═══════════════════════════════════════════════════
  // Schema from backend (injected by EJS)
  // ═══════════════════════════════════════════════════
  const SCHEMA = window.__ROLE_SCHEMA__ || {};
  const MAX_ABILITIES = SCHEMA.maxAbilities || 5;
  const FORBIDDEN_COMBOS = SCHEMA.forbiddenCombos || [];

  // ═══════════════════════════════════════════════════
  // Mapping Tables — Simple UI → Backend Schema
  // ═══════════════════════════════════════════════════

  /**
   * Maps simple "when" dropdown values to { type, trigger, phase }
   * This is THE core mapping: users pick a human phrase, we produce
   * the exact backend fields required.
   */
  const WHEN_MAP = {
    every_night:  { type: 'night_target',   trigger: 'night_action',     phase: 'night' },
    during_day:   { type: 'on_phase_start', trigger: 'phase_start',      phase: 'day'   },
    on_death:     { type: 'on_death',       trigger: 'player_death',     phase: null     },
    on_targeted:  { type: 'on_attacked',    trigger: 'player_targeted',  phase: null     },
    during_vote:  { type: 'on_vote',        trigger: 'vote_cast',        phase: 'day'    },
    passive:      { type: 'passive',        trigger: 'phase_start',      phase: 'any'    },
  };

  /**
   * Maps simple "who" dropdown to backend target type.
   * Some values are further refined based on what + when.
   */
  const WHO_MAP = {
    self:           'self',
    chosen_player:  'alive_other',   // Default — refined below
    automatic:      'none',
    no_target:      'none',
  };

  /**
   * Refine target based on effect for "chosen_player".
   * Some effects logically should target specific groups.
   */
  const EFFECT_TARGET_REFINE = {
    protect:           'alive_other',
    kill:              'alive_other',
    inspect_alignment: 'alive_other',
    inspect_role:      'alive_other',
    redirect:          'alive_other',
    silence:           'alive_other',
    block:             'alive_other',
    reveal_role:       'alive_other',
    reveal_alignment:  'alive_other',
    swap_roles:        'alive_other',
    double_vote:       'self',
    modify_vote_weight:'self',
    immune_to_kill:    'self',
    win_override:      'self',
  };

  /**
   * Effects that force "who" = self or no_target regardless of user pick.
   * These are auto-corrected silently.
   */
  const SELF_ONLY_EFFECTS = new Set(['immune_to_kill', 'double_vote', 'win_override']);
  const NO_TARGET_EFFECTS = new Set([]);

  // Type → required trigger mapping (for advanced mode validation)
  const TYPE_TRIGGER_MAP = {
    night_target: 'night_action',
    on_death: 'player_death',
    on_attacked: 'player_targeted',
    on_vote: 'vote_cast',
    on_phase_start: 'phase_start',
    on_phase_end: 'phase_end',
    passive: null,
  };

  const PASSIVE_TRIGGERS = ['phase_start', 'phase_end', 'player_targeted'];

  // Camp → win condition compatibility
  const CAMP_WIN_COMPAT = {
    village: ['village_wins', 'lovers_survive'],
    wolves: ['wolves_win', 'lovers_survive'],
    solo: ['solo_survive', 'lovers_survive'],
  };

  // Effect → parameter definitions for UI rendering
  const EFFECT_PARAMS = {
    protect: [
      { key: 'protectSelf', labelKey: 'roles.param_protect_self', type: 'checkbox', default: false },
    ],
    kill: [
      { key: 'bypassProtection', labelKey: 'roles.param_bypass_protection', type: 'checkbox', default: false },
    ],
    silence: [
      { key: 'duration', labelKey: 'roles.param_duration', type: 'number', min: 1, max: 5, default: 1 },
    ],
    block: [
      { key: 'duration', labelKey: 'roles.param_duration', type: 'number', min: 1, max: 5, default: 1 },
    ],
    reveal_role: [
      { key: 'toAll', labelKey: 'roles.param_visible_all', type: 'checkbox', default: false },
    ],
    reveal_alignment: [
      { key: 'toAll', labelKey: 'roles.param_visible_all', type: 'checkbox', default: false },
    ],
    modify_vote_weight: [
      { key: 'weight', labelKey: 'roles.param_vote_weight', type: 'number', min: 0, max: 5, step: 0.5, default: 2, required: true },
    ],
    immune_to_kill: [
      { key: 'maxUses', labelKey: 'roles.param_protection_count', type: 'number', min: 1, max: 10, default: 1 },
    ],
    win_override: [
      {
        key: 'condition', labelKey: 'roles.param_win_condition', type: 'select', required: true,
        options: [
          { value: 'village_wins', labelKey: 'roles.param_village_wins' },
          { value: 'wolves_win', labelKey: 'roles.param_wolves_win' },
          { value: 'solo_survive', labelKey: 'roles.param_solo_survive' },
          { value: 'lovers_survive', labelKey: 'roles.param_lovers_survive' },
        ],
      },
    ],
  };

  // ═══════════════════════════════════════════════════
  // Natural Language Summary Generator
  // ═══════════════════════════════════════════════════

  const WHEN_LABELS = {
    every_night: 'roles.when_every_night',
    during_day:  'roles.when_during_day',
    on_death:    'roles.when_on_death',
    on_targeted: 'roles.when_on_targeted',
    during_vote: 'roles.when_during_vote',
    passive:     'roles.when_passive',
  };

  const ACTION_PHRASES = {
    protect: {
      chosen_player: 'roles.phrase_protect_chosen',
      self: 'roles.phrase_protect_self',
      automatic: 'roles.phrase_protect_auto',
      no_target: 'roles.phrase_protect_none',
    },
    kill: {
      chosen_player: 'roles.phrase_kill_chosen',
      self: 'roles.phrase_kill_self',
      automatic: 'roles.phrase_kill_auto',
      no_target: 'roles.phrase_kill_none',
    },
    inspect_alignment: {
      chosen_player: 'roles.phrase_inspect_align_chosen',
      self: 'roles.phrase_inspect_align_self',
      automatic: 'roles.phrase_inspect_align_auto',
      no_target: 'roles.phrase_inspect_align_none',
    },
    inspect_role: {
      chosen_player: 'roles.phrase_inspect_role_chosen',
      self: 'roles.phrase_inspect_role_self',
      automatic: 'roles.phrase_inspect_role_auto',
      no_target: 'roles.phrase_inspect_role_none',
    },
    redirect: {
      chosen_player: 'roles.phrase_redirect_chosen',
      self: 'roles.phrase_redirect_self',
      automatic: 'roles.phrase_redirect_auto',
      no_target: 'roles.phrase_redirect_none',
    },
    double_vote: {
      chosen_player: 'roles.phrase_double_vote_chosen',
      self: 'roles.phrase_double_vote_self',
      automatic: 'roles.phrase_double_vote_auto',
      no_target: 'roles.phrase_double_vote_none',
    },
    immune_to_kill: {
      chosen_player: 'roles.phrase_immune_chosen',
      self: 'roles.phrase_immune_self',
      automatic: 'roles.phrase_immune_auto',
      no_target: 'roles.phrase_immune_none',
    },
    win_override: {
      chosen_player: 'roles.phrase_win_override_chosen',
      self: 'roles.phrase_win_override_self',
      automatic: 'roles.phrase_win_override_auto',
      no_target: 'roles.phrase_win_override_none',
    },
    silence: {
      chosen_player: 'roles.phrase_silence_chosen',
      self: 'roles.phrase_silence_self',
      automatic: 'roles.phrase_silence_auto',
      no_target: 'roles.phrase_silence_none',
    },
    block: {
      chosen_player: 'roles.phrase_block_chosen',
      self: 'roles.phrase_block_self',
      automatic: 'roles.phrase_block_auto',
      no_target: 'roles.phrase_block_none',
    },
    reveal_role: {
      chosen_player: 'roles.phrase_reveal_role_chosen',
      self: 'roles.phrase_reveal_role_self',
      automatic: 'roles.phrase_reveal_role_auto',
      no_target: 'roles.phrase_reveal_role_none',
    },
    reveal_alignment: {
      chosen_player: 'roles.phrase_reveal_align_chosen',
      self: 'roles.phrase_reveal_align_self',
      automatic: 'roles.phrase_reveal_align_auto',
      no_target: 'roles.phrase_reveal_align_none',
    },
    modify_vote_weight: {
      chosen_player: 'roles.phrase_modify_vote_chosen',
      self: 'roles.phrase_modify_vote_self',
      automatic: 'roles.phrase_modify_vote_auto',
      no_target: 'roles.phrase_modify_vote_none',
    },
    swap_roles: {
      chosen_player: 'roles.phrase_swap_chosen',
      self: 'roles.phrase_swap_self',
      automatic: 'roles.phrase_swap_auto',
      no_target: 'roles.phrase_swap_none',
    },
  };

  function getDefaultWho(what) {
    if (SELF_ONLY_EFFECTS.has(what)) return 'self';
    return what ? 'chosen_player' : '';
  }

  function generateSummary(when, what, who, chargesMode, chargesVal, cooldownMode, cooldownVal) {
    if (!when || !what) return '';

    const whenText = t(WHEN_LABELS[when] || when);
    const resolvedWho = who || getDefaultWho(what) || 'no_target';
    const whatKey = ACTION_PHRASES[what]?.[resolvedWho] || ACTION_PHRASES[what]?.no_target || 'roles.phrase_default';
    const whatText = t(whatKey);
    const fragments = [whenText + ', ' + t('roles.summary_this_role_can') + ' ' + whatText];

    // Charges
    if (chargesMode === 'limited' && chargesVal) {
      fragments.push(t('roles.summary_usable') + ' ' + chargesVal + ' ' + t('roles.summary_times_per_game'));
    }

    // Cooldown
    if (cooldownMode === 'has_cooldown' && cooldownVal) {
      fragments.push(t('roles.summary_cooldown') + ' ' + cooldownVal + ' ' + (cooldownVal > 1 ? t('roles.summary_turns') : t('roles.summary_turn')));
    }

    return fragments.join('. ') + '.';
  }

  // ═══════════════════════════════════════════════════
  // Simple → Schema Mapping
  // ═══════════════════════════════════════════════════

  /**
   * Convert a simple-mode ability card into backend ability JSON.
   * @param {Object} simple - { when, what, who, chargesMode, chargesVal, cooldownMode, cooldownVal, parameters }
   * @param {number} index - ability index for auto-generating ID
   * @returns {Object} Backend-compatible ability definition
   */
  function mapSimpleToSchema(simple, index) {
    const whenMapping = WHEN_MAP[simple.when] || {};
    const effect = simple.what;

    // Auto-generate ID from effect + index
    const id = (effect || 'ability') + '_' + index;

    // Determine target
    let target = WHO_MAP[simple.who] || 'none';
    if (simple.who === 'chosen_player' && EFFECT_TARGET_REFINE[effect]) {
      target = EFFECT_TARGET_REFINE[effect];
    }
    if (SELF_ONLY_EFFECTS.has(effect)) {
      target = 'self';
    }

    // Charges
    const charges = (simple.chargesMode === 'limited' && simple.chargesVal)
      ? parseInt(simple.chargesVal, 10) : null;

    // Cooldown
    const cooldown = (simple.cooldownMode === 'has_cooldown' && simple.cooldownVal)
      ? parseInt(simple.cooldownVal, 10) : null;

    return {
      id,
      type:       whenMapping.type || 'passive',
      trigger:    whenMapping.trigger || 'phase_start',
      phase:      whenMapping.phase || null,
      target,
      effect:     effect || '',
      charges,
      cooldown,
      parameters: simple.parameters || {},
    };
  }

  /**
   * Reverse-map a backend ability to simple-mode selections (for duplicate/prefill).
   */
  function mapSchemaToSimple(ability) {
    // Find the "when" match
    let when = '';
    for (const [key, mapping] of Object.entries(WHEN_MAP)) {
      if (mapping.type === ability.type && mapping.trigger === ability.trigger) {
        when = key;
        break;
      }
    }

    // Who
    let who = 'no_target';
    if (ability.target === 'self') who = 'self';
    else if (ability.target === 'none') who = ability.effect && !SELF_ONLY_EFFECTS.has(ability.effect) ? 'automatic' : 'no_target';
    else if (ability.target && ability.target !== 'none') who = 'chosen_player';

    return {
      when,
      what: ability.effect || '',
      who,
      chargesMode: ability.charges ? 'limited' : 'infinite',
      chargesVal: ability.charges || 1,
      cooldownMode: ability.cooldown ? 'has_cooldown' : 'none',
      cooldownVal: ability.cooldown || 2,
      parameters: ability.parameters || {},
    };
  }

  // ═══════════════════════════════════════════════════
  // Illegal Combination Prevention
  // ═══════════════════════════════════════════════════

  /**
   * Some when+what combinations don't make sense.
   * Returns an error message if illegal, or '' if OK.
   */
  function checkIllegalCombo(when, what) {
    // A passive "kill" doesn't make sense
    if (when === 'passive' && what === 'kill') {
      return t('roles.err_passive_kill');
    }
    // "On death" + protect is odd
    if (when === 'on_death' && what === 'protect') {
      return t('roles.err_death_protect');
    }
    if (when === 'on_death' && what === 'immune_to_kill') {
      return t('roles.err_death_immune');
    }
    return '';
  }

  // ═══════════════════════════════════════════════════
  // Camp Filter
  // ═══════════════════════════════════════════════════
  const filtersWrap = document.getElementById('rl-filters');
  if (filtersWrap) {
    const filterBtns = filtersWrap.querySelectorAll('.rl-filter');
    const allCards = document.querySelectorAll('.rl-card[data-camp]');
    const sections = document.querySelectorAll('.rl-section');

    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const camp = btn.dataset.camp;

        allCards.forEach(card => {
          if (camp === 'all' || card.dataset.camp === camp) {
            card.classList.remove('rl-hidden');
          } else {
            card.classList.add('rl-hidden');
          }
        });

        sections.forEach(sec => {
          if (sec.id === 'custom-roles') return;
          const grid = sec.querySelector('.rl-grid');
          if (!grid) return;
          const visible = grid.querySelectorAll('.rl-card:not(.rl-hidden)');
          sec.classList.toggle('rl-section-hidden', visible.length === 0);
        });
      });
    });
  }

  // ═══════════════════════════════════════════════════
  // Flip All Cards
  // ═══════════════════════════════════════════════════
  const flipBtn = document.getElementById('btn-flip-all');
  if (flipBtn) {
    let isFlipped = false;
    let animating = false;

    flipBtn.addEventListener('click', () => {
      if (animating) return;
      animating = true;

      const cards = document.querySelectorAll('.rl-flip-inner');
      const target = !isFlipped;
      const delay = 60;

      cards.forEach((card, i) => {
        setTimeout(() => {
          if (target) {
            card.classList.remove('unflipped');
            card.classList.add('flipped');
          } else {
            card.classList.remove('flipped');
            card.classList.add('unflipped');
            card.addEventListener('transitionend', function handler() {
              card.classList.remove('unflipped');
              card.removeEventListener('transitionend', handler);
            });
          }
          if (i === cards.length - 1) {
            isFlipped = target;
            flipBtn.classList.toggle('flipped', isFlipped);
            animating = false;
          }
        }, i * delay);
      });
    });
  }

  // ═══════════════════════════════════════════════════
  // Ability Builder — Narrative + Advanced Mode
  // ═══════════════════════════════════════════════════
  const form = document.getElementById('create-role-form');
  if (!form) return; // Not admin — exit early

  const container = document.getElementById('abilities-container');
  const template = document.getElementById('ability-card-template');
  const addBtn = document.getElementById('btn-add-ability');
  const countBadge = document.getElementById('ability-count-badge');
  const limitHint = document.getElementById('ability-limit-hint');
  const globalErrors = document.getElementById('role-global-errors');
  const campSelect = document.getElementById('role-camp');
  const winSelect = document.getElementById('role-win-condition');
  const advancedToggle = document.getElementById('ab-advanced-toggle');
  const modeHint = document.getElementById('ab-mode-hint');

  let abilityIndex = 0;
  let isAdvancedMode = false;

  // ── Advanced mode toggle ──
  advancedToggle.addEventListener('change', () => {
    isAdvancedMode = advancedToggle.checked;
    modeHint.textContent = isAdvancedMode
      ? t('roles.mode_advanced_hint')
      : t('roles.mode_simple_hint');

    container.querySelectorAll('.ability-card').forEach(card => {
      syncModeVisibility(card);
    });
  });

  function syncModeVisibility(card) {
    const simpleMode = card.querySelector('.ab-simple-mode');
    const advancedMode = card.querySelector('.ab-advanced-mode');

    if (isAdvancedMode) {
      // Sync simple → advanced before showing
      syncSimpleToAdvanced(card);
      simpleMode.style.display = 'none';
      advancedMode.style.display = '';
    } else {
      // Sync advanced → simple before showing
      syncAdvancedToSimple(card);
      simpleMode.style.display = '';
      advancedMode.style.display = 'none';
    }
  }

  /**
   * Copy simple mode values into advanced mode fields.
   */
  function syncSimpleToAdvanced(card) {
    const simple = readSimpleFields(card);
    const schema = mapSimpleToSchema(simple, parseInt(card.dataset.abilityIndex, 10));

    const advId = card.querySelector('.ab-id');
    const advType = card.querySelector('.ab-type');
    const advTrigger = card.querySelector('.ab-trigger');
    const advEffect = card.querySelector('.ab-effect');
    const advTarget = card.querySelector('.ab-target');
    const advPhase = card.querySelector('.ab-phase');
    const advCharges = card.querySelector('.ab-charges');
    const advCooldown = card.querySelector('.ab-cooldown');

    if (advId && !advId.value) advId.value = schema.id;
    if (advType) advType.value = schema.type;
    if (advTrigger) advTrigger.value = schema.trigger;
    if (advEffect) advEffect.value = schema.effect;
    if (advTarget) advTarget.value = schema.target || 'none';
    if (advPhase) advPhase.value = schema.phase || '';
    if (advCharges) advCharges.value = schema.charges || '';
    if (advCooldown) advCooldown.value = schema.cooldown || '';

    // Render advanced parameter fields
    renderParameterFieldsAdvanced(card, schema.effect);
    if (schema.parameters) {
      setTimeout(() => fillParameterFieldsAdvanced(card, schema.parameters), 0);
    }
  }

  /**
   * Copy advanced mode values into simple mode fields (best-effort reverse map).
   */
  function syncAdvancedToSimple(card) {
    const adv = readAdvancedFields(card);
    const simple = mapSchemaToSimple(adv);

    const whenSel = card.querySelector('.ab-when');
    const whatSel = card.querySelector('.ab-what');
    const whoSel = card.querySelector('.ab-who');

    if (whenSel && simple.when) whenSel.value = simple.when;
    if (whatSel && simple.what) whatSel.value = simple.what;
    if (whoSel && simple.who) whoSel.value = simple.who;

    // Charges
    const chargesRadios = card.querySelectorAll('.ab-charges-mode');
    const chargesVal = card.querySelector('.ab-charges-val');
    chargesRadios.forEach(r => {
      r.checked = r.value === simple.chargesMode;
    });
    if (chargesVal) {
      chargesVal.disabled = simple.chargesMode !== 'limited';
      if (simple.chargesVal) chargesVal.value = simple.chargesVal;
    }

    // Cooldown
    const cooldownRadios = card.querySelectorAll('.ab-cooldown-mode');
    const cooldownVal = card.querySelector('.ab-cooldown-val');
    cooldownRadios.forEach(r => {
      r.checked = r.value === simple.cooldownMode;
    });
    if (cooldownVal) {
      cooldownVal.disabled = simple.cooldownMode !== 'has_cooldown';
      if (simple.cooldownVal) cooldownVal.value = simple.cooldownVal;
    }

    // Update summary
    updateSummary(card);

    // Parameters
    renderParameterFields(card, simple.what);
    if (simple.parameters) {
      setTimeout(() => fillParameterFields(card, simple.parameters), 0);
    }
  }

  // ── Camp ↔ Win Condition sync ──
  campSelect.addEventListener('change', () => {
    const camp = campSelect.value;
    const compatible = CAMP_WIN_COMPAT[camp] || [];
    Array.from(winSelect.options).forEach(opt => {
      opt.disabled = !compatible.includes(opt.value);
    });
    if (!compatible.includes(winSelect.value)) {
      winSelect.value = compatible[0] || '';
    }
    updateStrategicProfile();
  });
  campSelect.dispatchEvent(new Event('change'));

  // ── Add Ability ──
  addBtn.addEventListener('click', () => {
    if (container.children.length >= MAX_ABILITIES) return;
    addAbilityCard();
  });

  function addAbilityCard(data) {
    if (container.children.length >= MAX_ABILITIES) return null;

    const clone = template.content.cloneNode(true);
    const card = clone.querySelector('.ability-card');
    const idx = abilityIndex++;
    card.dataset.abilityIndex = idx;
    card.querySelector('.ability-num').textContent = container.children.length + 1;

    // Give unique radio button group names
    const chargesRadios = card.querySelectorAll('.ab-charges-mode');
    chargesRadios.forEach(r => r.name = 'charges_mode_' + idx);

    const cooldownRadios = card.querySelectorAll('.ab-cooldown-mode');
    cooldownRadios.forEach(r => r.name = 'cooldown_mode_' + idx);

    // ── Simple mode event listeners ──
    const whenSel = card.querySelector('.ab-when');
    const whatSel = card.querySelector('.ab-what');
    const whoSel = card.querySelector('.ab-who');
    const chargesVal = card.querySelector('.ab-charges-val');
    const cooldownVal = card.querySelector('.ab-cooldown-val');

    // Default hidden target type for simple mode
    whoSel.value = 'chosen_player';

    // Update summary on any change
    const updateCardSummary = () => updateSummary(card);

    whenSel.addEventListener('change', () => {
      // Check illegal combo
      const err = checkIllegalCombo(whenSel.value, whatSel.value);
      card.querySelector('.ab-err-when').textContent = err;
      updateCardSummary();
    });

    whatSel.addEventListener('change', () => {
      // Auto-adjust "who" for self-only effects
      if (SELF_ONLY_EFFECTS.has(whatSel.value)) {
        whoSel.value = 'self';
      } else if (!whoSel.value) {
        whoSel.value = getDefaultWho(whatSel.value);
      }
      // Check illegal combo
      const err = checkIllegalCombo(whenSel.value, whatSel.value);
      card.querySelector('.ab-err-when').textContent = err;
      // Render parameters
      renderParameterFields(card, whatSel.value);
      updateCardSummary();
    });

    whoSel.addEventListener('change', updateCardSummary);

    // Charges radio behavior
    chargesRadios.forEach(r => {
      r.addEventListener('change', () => {
        chargesVal.disabled = r.value !== 'limited' || !r.checked;
        if (r.value === 'limited' && r.checked) chargesVal.focus();
        updateCardSummary();
      });
    });
    chargesVal.addEventListener('input', updateCardSummary);

    // Cooldown radio behavior
    cooldownRadios.forEach(r => {
      r.addEventListener('change', () => {
        cooldownVal.disabled = r.value !== 'has_cooldown' || !r.checked;
        if (r.value === 'has_cooldown' && r.checked) cooldownVal.focus();
        updateCardSummary();
      });
    });
    cooldownVal.addEventListener('input', updateCardSummary);

    // ── Advanced mode event listeners ──
    const advTypeSelect = card.querySelector('.ab-type');
    const advTriggerSelect = card.querySelector('.ab-trigger');
    const advEffectSelect = card.querySelector('.ab-effect');

    advTypeSelect.addEventListener('change', () => {
      const t = advTypeSelect.value;
      const mapped = TYPE_TRIGGER_MAP[t];
      if (mapped) {
        advTriggerSelect.value = mapped;
        advTriggerSelect.disabled = true;
      } else if (t === 'passive') {
        advTriggerSelect.disabled = false;
        Array.from(advTriggerSelect.options).forEach(opt => {
          if (opt.value === '') return;
          opt.disabled = !PASSIVE_TRIGGERS.includes(opt.value);
        });
        if (!PASSIVE_TRIGGERS.includes(advTriggerSelect.value)) {
          advTriggerSelect.value = '';
        }
      } else {
        advTriggerSelect.disabled = false;
        Array.from(advTriggerSelect.options).forEach(opt => { opt.disabled = false; });
      }
    });

    advEffectSelect.addEventListener('change', () => {
      renderParameterFieldsAdvanced(card, advEffectSelect.value);
      updateStrategicProfile();
    });

    // Collapse / expand
    const toggleBtn = card.querySelector('.ability-toggle');
    const body = card.querySelector('.ability-card-body');
    toggleBtn.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggleBtn.textContent = collapsed ? '\u25BC' : '\u25B6';
    });

    // Duplicate
    card.querySelector('.ability-duplicate').addEventListener('click', () => {
      const abilityData = isAdvancedMode ? readAdvancedFields(card) : readAbilityFromCard(card);
      if (abilityData) {
        abilityData.id = (abilityData.id || 'ability') + '_copy';
        addAbilityCard(abilityData);
      }
    });

    // Remove
    card.querySelector('.ability-remove').addEventListener('click', () => {
      card.remove();
      updateAbilityNumbers();
      updateAbilityUI();
    });

    // Pre-fill from data (for duplicate or edit)
    if (data) {
      const simple = mapSchemaToSimple(data);

      // Simple mode fields
      whenSel.value = simple.when;
      whatSel.value = simple.what;
      whoSel.value = simple.who;

      chargesRadios.forEach(r => r.checked = r.value === simple.chargesMode);
      chargesVal.disabled = simple.chargesMode !== 'limited';
      if (simple.chargesVal) chargesVal.value = simple.chargesVal;

      cooldownRadios.forEach(r => r.checked = r.value === simple.cooldownMode);
      cooldownVal.disabled = simple.cooldownMode !== 'has_cooldown';
      if (simple.cooldownVal) cooldownVal.value = simple.cooldownVal;

      renderParameterFields(card, simple.what);
      if (simple.parameters && Object.keys(simple.parameters).length > 0) {
        setTimeout(() => fillParameterFields(card, simple.parameters), 0);
      }

      // Advanced mode fields
      card.querySelector('.ab-id').value = data.id || '';
      advTypeSelect.value = data.type || '';
      advTypeSelect.dispatchEvent(new Event('change'));
      advTriggerSelect.value = data.trigger || '';
      advEffectSelect.value = data.effect || '';
      advEffectSelect.dispatchEvent(new Event('change'));
      card.querySelector('.ab-target').value = data.target || 'none';
      card.querySelector('.ab-phase').value = data.phase || '';
      card.querySelector('.ab-charges').value = data.charges || '';
      card.querySelector('.ab-cooldown').value = data.cooldown || '';
      if (data.parameters) {
        setTimeout(() => fillParameterFieldsAdvanced(card, data.parameters), 0);
      }
    }

    // Set correct mode visibility
    syncModeVisibility(card);

    container.appendChild(card);
    if (window.webI18n && window.webI18n.applyTranslations) window.webI18n.applyTranslations(window.webI18n.getLang());
    updateAbilityUI();
    updateSummary(card);
    return card;
  }

  // ═══════════════════════════════════════════════════
  // Read fields from cards
  // ═══════════════════════════════════════════════════

  function readSimpleFields(card) {
    const when = card.querySelector('.ab-when').value;
    const what = card.querySelector('.ab-what').value;
    const who = card.querySelector('.ab-who').value;

    const chargesMode = card.querySelector('.ab-charges-mode:checked')?.value || 'infinite';
    const chargesVal = card.querySelector('.ab-charges-val').value;
    const cooldownMode = card.querySelector('.ab-cooldown-mode:checked')?.value || 'none';
    const cooldownVal = card.querySelector('.ab-cooldown-val').value;

    const parameters = {};
    card.querySelectorAll('.ab-simple-mode .ab-param').forEach(input => {
      const key = input.dataset.paramKey;
      if (input.type === 'checkbox') {
        parameters[key] = input.checked;
      } else if (input.type === 'number') {
        if (input.value !== '') parameters[key] = parseFloat(input.value);
      } else {
        if (input.value) parameters[key] = input.value;
      }
    });

    // Remove default false booleans
    for (const key of Object.keys(parameters)) {
      if (parameters[key] === false) delete parameters[key];
    }

    return { when, what, who, chargesMode, chargesVal, cooldownMode, cooldownVal, parameters };
  }

  function readAdvancedFields(card) {
    const id = card.querySelector('.ab-id').value.trim();
    const type = card.querySelector('.ab-type').value;
    const trigger = card.querySelector('.ab-trigger').value;
    const effect = card.querySelector('.ab-effect').value;
    const target = card.querySelector('.ab-target').value || 'none';
    const phase = card.querySelector('.ab-phase').value || null;
    const chargesVal = card.querySelector('.ab-charges').value;
    const cooldownVal = card.querySelector('.ab-cooldown').value;

    const charges = chargesVal ? parseInt(chargesVal, 10) : null;
    const cooldown = cooldownVal ? parseInt(cooldownVal, 10) : null;

    const parameters = {};
    card.querySelectorAll('.ab-advanced-mode .ab-param').forEach(input => {
      const key = input.dataset.paramKey;
      if (input.type === 'checkbox') {
        parameters[key] = input.checked;
      } else if (input.type === 'number') {
        if (input.value !== '') parameters[key] = parseFloat(input.value);
      } else {
        if (input.value) parameters[key] = input.value;
      }
    });

    for (const key of Object.keys(parameters)) {
      if (parameters[key] === false) delete parameters[key];
    }

    return { id, type, trigger, effect, target, phase, charges, cooldown, parameters };
  }

  /**
   * Read ability from card — dispatches to simple or advanced based on mode.
   * Always returns a backend-compatible ability object.
   */
  function readAbilityFromCard(card) {
    if (isAdvancedMode) {
      return readAdvancedFields(card);
    }
    // Simple mode: map to schema
    const simple = readSimpleFields(card);
    const idx = parseInt(card.dataset.abilityIndex, 10);
    const schema = mapSimpleToSchema(simple, idx);

    // Keep any custom ID from advanced mode if set
    const advId = card.querySelector('.ab-id').value.trim();
    if (advId) schema.id = advId;

    return schema;
  }

  // ═══════════════════════════════════════════════════
  // Summary Update
  // ═══════════════════════════════════════════════════

  function updateSummary(card) {
    const summaryEl = card.querySelector('.ab-summary');
    const textEl = card.querySelector('.ab-summary-text');
    if (!summaryEl || !textEl) return;

    const simple = readSimpleFields(card);
    const text = generateSummary(
      simple.when, simple.what, simple.who,
      simple.chargesMode, simple.chargesVal,
      simple.cooldownMode, simple.cooldownVal
    );

    if (text) {
      textEl.textContent = text;
      summaryEl.style.display = '';
    } else {
      summaryEl.style.display = 'none';
    }

    // Update strategic profile on every ability change
    updateStrategicProfile();
  }

  // ═══════════════════════════════════════════════════
  // Parameter Fields (Simple Mode)
  // ═══════════════════════════════════════════════════

  function renderParameterFields(card, effect) {
    const paramsContainer = card.querySelector('.ab-simple-mode .ab-parameters');
    const fieldsDiv = card.querySelector('.ab-simple-mode .ab-params-fields');
    if (!paramsContainer || !fieldsDiv) return;
    fieldsDiv.innerHTML = '';

    const params = EFFECT_PARAMS[effect];
    if (!params || params.length === 0) {
      paramsContainer.style.display = 'none';
      return;
    }

    paramsContainer.style.display = '';
    params.forEach(p => {
      const wrapper = document.createElement('div');
      wrapper.className = 'form-group form-group-inline';

      if (p.type === 'checkbox') {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ab-param';
        input.dataset.paramKey = p.key;
        input.checked = !!p.default;
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + t(p.labelKey)));
        wrapper.appendChild(label);
      } else if (p.type === 'number') {
        const label = document.createElement('label');
        label.textContent = t(p.labelKey);
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'form-input form-input-sm ab-param';
        input.dataset.paramKey = p.key;
        input.min = p.min != null ? p.min : '';
        input.max = p.max != null ? p.max : '';
        if (p.step) input.step = p.step;
        if (p.default !== undefined) input.placeholder = String(p.default);
        if (p.required) input.required = true;
        wrapper.appendChild(label);
        wrapper.appendChild(input);
      } else if (p.type === 'select') {
        const label = document.createElement('label');
        label.textContent = t(p.labelKey);
        const select = document.createElement('select');
        select.className = 'form-select ab-param';
        select.dataset.paramKey = p.key;
        if (p.required) select.required = true;
        (p.options || []).forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = t(opt.labelKey);
          select.appendChild(option);
        });
        wrapper.appendChild(label);
        wrapper.appendChild(select);
      }
      fieldsDiv.appendChild(wrapper);
    });
  }

  function fillParameterFields(card, parameters) {
    if (!parameters) return;
    card.querySelectorAll('.ab-simple-mode .ab-param').forEach(input => {
      const key = input.dataset.paramKey;
      if (key in parameters) {
        if (input.type === 'checkbox') {
          input.checked = !!parameters[key];
        } else {
          input.value = parameters[key];
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // Parameter Fields (Advanced Mode)
  // ═══════════════════════════════════════════════════

  function renderParameterFieldsAdvanced(card, effect) {
    const paramsContainer = card.querySelector('.ab-parameters-adv');
    const fieldsDiv = card.querySelector('.ab-params-fields-adv');
    if (!paramsContainer || !fieldsDiv) return;
    fieldsDiv.innerHTML = '';

    const params = EFFECT_PARAMS[effect];
    if (!params || params.length === 0) {
      paramsContainer.style.display = 'none';
      return;
    }

    paramsContainer.style.display = '';
    params.forEach(p => {
      const wrapper = document.createElement('div');
      wrapper.className = 'form-group form-group-inline';

      if (p.type === 'checkbox') {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'ab-param';
        input.dataset.paramKey = p.key;
        input.checked = !!p.default;
        label.appendChild(input);
        label.appendChild(document.createTextNode(' ' + t(p.labelKey)));
        wrapper.appendChild(label);
      } else if (p.type === 'number') {
        const label = document.createElement('label');
        label.textContent = t(p.labelKey);
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'form-input form-input-sm ab-param';
        input.dataset.paramKey = p.key;
        input.min = p.min != null ? p.min : '';
        input.max = p.max != null ? p.max : '';
        if (p.step) input.step = p.step;
        if (p.default !== undefined) input.placeholder = String(p.default);
        if (p.required) input.required = true;
        wrapper.appendChild(label);
        wrapper.appendChild(input);
      } else if (p.type === 'select') {
        const label = document.createElement('label');
        label.textContent = t(p.labelKey);
        const select = document.createElement('select');
        select.className = 'form-select ab-param';
        select.dataset.paramKey = p.key;
        if (p.required) select.required = true;
        (p.options || []).forEach(opt => {
          const option = document.createElement('option');
          option.value = opt.value;
          option.textContent = t(opt.labelKey);
          select.appendChild(option);
        });
        wrapper.appendChild(label);
        wrapper.appendChild(select);
      }
      fieldsDiv.appendChild(wrapper);
    });
  }

  function fillParameterFieldsAdvanced(card, parameters) {
    if (!parameters) return;
    card.querySelectorAll('.ab-advanced-mode .ab-param').forEach(input => {
      const key = input.dataset.paramKey;
      if (key in parameters) {
        if (input.type === 'checkbox') {
          input.checked = !!parameters[key];
        } else {
          input.value = parameters[key];
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════════════════

  function updateAbilityNumbers() {
    const cards = container.querySelectorAll('.ability-card');
    cards.forEach((c, i) => {
      c.querySelector('.ability-num').textContent = i + 1;
    });
  }

  function updateAbilityUI() {
    const count = container.children.length;
    countBadge.textContent = count;
    addBtn.disabled = count >= MAX_ABILITIES;
    limitHint.textContent = count >= MAX_ABILITIES
      ? t('roles.ability_max_reached').replace('{max}', MAX_ABILITIES)
      : (MAX_ABILITIES - count) + ' ' + t('roles.ability_remaining');
    updateStrategicProfile();
  }

  // ═══════════════════════════════════════════════════
  // Client-side Validation
  // ═══════════════════════════════════════════════════

  function clearAllErrors() {
    form.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    globalErrors.style.display = 'none';
    globalErrors.innerHTML = '';
  }

  function showFieldError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
  }

  function showGlobalError(msg) {
    globalErrors.style.display = '';
    const p = document.createElement('p');
    p.textContent = msg;
    globalErrors.appendChild(p);
  }

  function validateForm() {
    clearAllErrors();
    let valid = true;

    const name = form.querySelector('#role-name').value.trim();
    if (!name || name.length < 1 || name.length > 50) {
      showFieldError('err-name', t('roles.err_name_length'));
      valid = false;
    }

    const camp = campSelect.value;
    if (!['village', 'wolves', 'solo'].includes(camp)) {
      showFieldError('err-camp', t('roles.err_camp_invalid'));
      valid = false;
    }

    const winCondition = winSelect.value;
    if (!winCondition) {
      showFieldError('err-winCondition', t('roles.err_win_required'));
      valid = false;
    }

    const compat = CAMP_WIN_COMPAT[camp] || [];
    if (winCondition && !compat.includes(winCondition)) {
      showFieldError('err-winCondition', t('roles.err_win_incompatible').replace('{camp}', camp));
      valid = false;
    }

    const guildId = form.querySelector('#role-guild-id').value;
    if (!guildId) {
      showFieldError('err-guildId', t('roles.err_guild_required'));
      valid = false;
    }

    // Abilities
    const abilityCards = container.querySelectorAll('.ability-card');
    const effects = [];

    if (isAdvancedMode) {
      // ── Advanced mode validation (original logic) ──
      const abilityIds = new Set();
      abilityCards.forEach(card => {
        const data = readAdvancedFields(card);

        if (!data.id || data.id.length < 1) {
          card.querySelector('.ab-err-id').textContent = t('roles.err_id_required');
          valid = false;
        } else if (!/^[a-z0-9_]+$/.test(data.id)) {
          card.querySelector('.ab-err-id').textContent = t('roles.err_id_format');
          valid = false;
        } else if (abilityIds.has(data.id)) {
          card.querySelector('.ab-err-id').textContent = t('roles.err_id_duplicate');
          valid = false;
        } else {
          card.querySelector('.ab-err-id').textContent = '';
        }
        abilityIds.add(data.id);

        if (!data.type) {
          card.querySelector('.ab-err-type').textContent = t('roles.err_type_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-type').textContent = '';
        }

        if (!data.trigger) {
          card.querySelector('.ab-err-trigger').textContent = t('roles.err_trigger_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-trigger').textContent = '';
        }

        if (data.type && data.trigger) {
          const expected = TYPE_TRIGGER_MAP[data.type];
          if (expected && data.trigger !== expected) {
            card.querySelector('.ab-err-trigger').textContent =
              t('roles.err_type_trigger_mismatch').replace('{type}', data.type).replace('{trigger}', expected);
            valid = false;
          }
          if (data.type === 'passive' && !PASSIVE_TRIGGERS.includes(data.trigger)) {
            card.querySelector('.ab-err-trigger').textContent = t('roles.err_trigger_invalid_passive');
            valid = false;
          }
        }

        if (!data.effect) {
          card.querySelector('.ab-err-effect').textContent = t('roles.err_effect_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-effect').textContent = '';
          effects.push(data.effect);
        }

        if (data.charges !== null && (data.charges < 1 || data.charges > 99)) {
          card.querySelector('.ab-err-general').textContent = t('roles.err_charges_range');
          valid = false;
        }

        if (data.cooldown !== null && (data.cooldown < 1 || data.cooldown > 10)) {
          card.querySelector('.ab-err-general').textContent = t('roles.err_cooldown_range');
          valid = false;
        }

        if (data.effect === 'modify_vote_weight') {
          if (data.parameters.weight === undefined || data.parameters.weight === null || isNaN(data.parameters.weight)) {
            card.querySelector('.ab-err-general').textContent = t('roles.err_vote_weight_required');
            valid = false;
          }
        }
        if (data.effect === 'win_override') {
          if (!data.parameters.condition) {
            card.querySelector('.ab-err-general').textContent = t('roles.err_win_condition_required');
            valid = false;
          }
        }
      });
    } else {
      // ── Simple mode validation ──
      abilityCards.forEach(card => {
        const simple = readSimpleFields(card);

        if (!simple.when) {
          card.querySelector('.ab-err-when').textContent = t('roles.err_when_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-when').textContent = '';
        }

        if (!simple.what) {
          card.querySelector('.ab-err-what').textContent = t('roles.err_what_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-what').textContent = '';
          effects.push(simple.what);
        }

        if (!simple.who) {
          card.querySelector('.ab-err-who').textContent = t('roles.err_who_required');
          valid = false;
        } else {
          card.querySelector('.ab-err-who').textContent = '';
        }

        // Illegal combo check
        if (simple.when && simple.what) {
          const err = checkIllegalCombo(simple.when, simple.what);
          if (err) {
            card.querySelector('.ab-err-when').textContent = err;
            valid = false;
          }
        }

        // Charges validation
        if (simple.chargesMode === 'limited') {
          const c = parseInt(simple.chargesVal, 10);
          if (!c || c < 1 || c > 99) {
            showGlobalError(t('roles.err_charges_invalid'));
            valid = false;
          }
        }

        // Cooldown validation
        if (simple.cooldownMode === 'has_cooldown') {
          const cd = parseInt(simple.cooldownVal, 10);
          if (!cd || cd < 1 || cd > 10) {
            showGlobalError(t('roles.err_cooldown_invalid'));
            valid = false;
          }
        }

        // Required params
        if (simple.what === 'modify_vote_weight') {
          const weightParam = card.querySelector('.ab-simple-mode .ab-param[data-param-key="weight"]');
          if (weightParam && (weightParam.value === '' || isNaN(parseFloat(weightParam.value)))) {
            showGlobalError(t('roles.err_vote_weight_required'));
            valid = false;
          }
        }
        if (simple.what === 'win_override') {
          const condParam = card.querySelector('.ab-simple-mode .ab-param[data-param-key="condition"]');
          if (condParam && !condParam.value) {
            showGlobalError(t('roles.err_win_condition_required'));
            valid = false;
          }
        }
      });
    }

    // Forbidden combos (applies in both modes)
    for (const [a, b] of FORBIDDEN_COMBOS) {
      if (effects.includes(a) && effects.includes(b)) {
        showGlobalError(t('roles.err_forbidden_combo').replace('{a}', a).replace('{b}', b));
        valid = false;
      }
    }

    return valid;
  }

  // ═══════════════════════════════════════════════════
  // Form Submission
  // ═══════════════════════════════════════════════════

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const _submitBtn = document.getElementById('btn-submit-role');
    _submitBtn.disabled = true;
    _submitBtn.textContent = editingRoleId ? t('roles.btn_saving') : t('roles.btn_creating');

    try {
      const abilities = [];
      container.querySelectorAll('.ability-card').forEach(card => {
        abilities.push(readAbilityFromCard(card));
      });

      const guildId = editingGuildId || form.querySelector('#role-guild-id').value;

      const roleDefinition = {
        name: form.querySelector('#role-name').value.trim(),
        emoji: form.querySelector('#role-emoji').value.trim() || '\u2753',
        camp: campSelect.value,
        winCondition: winSelect.value,
        description: form.querySelector('#role-description').value.trim(),
        abilities,
      };

      const payload = {
        guildId,
        ...roleDefinition,
        roleDefinition,
      };

      const isEdit = !!editingRoleId;
      const url = isEdit ? '/api/roles/' + editingRoleId : '/api/roles';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (result.success) {
        location.reload();
      } else {
        clearAllErrors();
        const errs = result.errors || [result.error || t('roles.err_unknown')];
        errs.forEach(err => showGlobalError(err));
      }
    } catch (err) {
      clearAllErrors();
      showGlobalError(t('roles.err_request_failed') + ' ' + err.message);
    } finally {
      _submitBtn.disabled = false;
      _submitBtn.textContent = editingRoleId ? t('roles.btn_save') : t('roles.btn_create');
    }
  });

  // ═══════════════════════════════════════════════════
  // Edit Mode State
  // ═══════════════════════════════════════════════════
  let editingRoleId = null;
  let editingGuildId = null;
  const submitBtn = document.getElementById('btn-submit-role');
  const createTitle = document.querySelector('.rl-create-title');

  function enterEditMode(roleId, guildId, roleData) {
    editingRoleId = roleId;
    editingGuildId = guildId;

    // Update UI to show edit state
    if (createTitle) createTitle.innerHTML = '✏️ ' + t('roles.edit_title') + ' <em>' + (roleData.name || '') + '</em>';
    if (submitBtn) submitBtn.textContent = t('roles.btn_save');

    // Show cancel button
    let cancelBtn = document.getElementById('btn-cancel-edit');
    if (!cancelBtn) {
      cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.id = 'btn-cancel-edit';
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.style.marginLeft = '0.5rem';
      cancelBtn.textContent = t('roles.btn_cancel');
      cancelBtn.addEventListener('click', exitEditMode);
      submitBtn.parentElement.insertBefore(cancelBtn, submitBtn.nextSibling);
    }
    cancelBtn.style.display = '';

    // Populate form fields
    form.querySelector('#role-name').value = roleData.name || '';
    form.querySelector('#role-emoji').value = roleData.emoji || '';
    const emojiPreview = document.getElementById('emoji-picker-preview');
    if (emojiPreview) emojiPreview.textContent = roleData.emoji || '❓';
    campSelect.value = roleData.camp || 'village';
    winSelect.value = roleData.winCondition || 'village_wins';
    form.querySelector('#role-description').value = roleData.description || '';
    const guildSelect = form.querySelector('#role-guild-id');
    if (guildSelect) {
      guildSelect.value = guildId;
      guildSelect.disabled = true; // Can't change guild during edit
    }

    // Clear existing abilities and populate from role data
    container.innerHTML = '';
    abilityIndex = 0;
    if (roleData.abilities && roleData.abilities.length > 0) {
      roleData.abilities.forEach(ab => addAbilityCard(ab));
    }
    updateAbilityUI();

    // Scroll to the form
    const panel = document.getElementById('role-builder-panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exitEditMode() {
    editingRoleId = null;
    editingGuildId = null;

    // Reset UI
    if (createTitle) createTitle.innerHTML = '🔧 ' + t('roles.create_title');
    if (submitBtn) submitBtn.textContent = t('roles.btn_create');
    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Reset form
    form.reset();
    const emojiPreview = document.getElementById('emoji-picker-preview');
    if (emojiPreview) emojiPreview.textContent = '❓';
    const guildSelect = form.querySelector('#role-guild-id');
    if (guildSelect) guildSelect.disabled = false;
    container.innerHTML = '';
    abilityIndex = 0;
    updateAbilityUI();
  }

  // ═══════════════════════════════════════════════════
  // Edit Roles
  // ═══════════════════════════════════════════════════
  document.querySelectorAll('.edit-role').forEach(btn => {
    btn.addEventListener('click', async () => {
      const roleId = btn.dataset.roleId;
      const guildId = btn.dataset.guildId;
      btn.disabled = true;
      btn.textContent = '⏳';
      try {
        const res = await fetch('/api/roles/' + roleId + '?guildId=' + encodeURIComponent(guildId));
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
          alert(t('roles.alert_unexpected_response') + ' (' + res.status + ')');
          return;
        }
        const result = await res.json();
        if (result.success && result.data) {
          enterEditMode(roleId, guildId, result.data);
        } else {
          alert(t('roles.alert_error') + ' ' + (result.error || t('roles.err_role_not_found')));
        }
      } catch (err) {
        console.error('Edit role fetch error:', err);
        alert(t('roles.alert_error') + ' ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '✏️ ' + t('roles.btn_edit');
      }
    });
  });

  // ═══════════════════════════════════════════════════
  // Delete Roles
  // ═══════════════════════════════════════════════════
  document.querySelectorAll('.delete-role').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(t('roles.confirm_delete'))) return;
      const roleId = btn.dataset.roleId;
      const guildId = btn.dataset.guildId;
      try {
        const res = await fetch('/api/roles/' + roleId + '?guildId=' + encodeURIComponent(guildId), {
          method: 'DELETE',
        });
        const result = await res.json();
        if (result.success) {
          const card = btn.closest('.rl-card');
          if (card) card.remove();
          const remaining = document.querySelectorAll('#custom-roles .rl-card');
          if (remaining.length === 0) location.reload();
        } else {
          alert(t('roles.alert_error') + ' ' + (result.errors ? result.errors.join(', ') : result.error || t('roles.err_unknown')));
        }
      } catch (err) {
        alert(t('roles.alert_error') + ' ' + err.message);
      }
    });
  });

  // ═══════════════════════════════════════════════════
  // Emoji Picker
  // ═══════════════════════════════════════════════════
  (function initEmojiPicker() {
    const trigger = document.getElementById('emoji-picker-trigger');
    const dropdown = document.getElementById('emoji-picker-dropdown');
    const preview = document.getElementById('emoji-picker-preview');
    const hiddenInput = document.getElementById('role-emoji');
    const searchInput = document.getElementById('emoji-picker-search');
    const grid = document.getElementById('emoji-picker-grid');
    const catsBar = document.getElementById('emoji-picker-cats');
    if (!trigger || !dropdown) return;

    const EMOJI_DATA = [
      { cat: 'Loups', icon: '\uD83D\uDC3A', emojis: ['\uD83D\uDC3A','\uD83D\uDC3B','\uD83E\uDD8A','\uD83D\uDC15','\uD83D\uDC3E','\uD83C\uDF19','\uD83C\uDF11','\uD83C\uDF1A','\uD83D\uDC80','\u2620\uFE0F','\uD83D\uDDE1\uFE0F','\uD83C\uDFAD','\u2694\uFE0F','\uD83E\uDDB7','\uD83E\uDDDB'] },
      { cat: 'Village', icon: '\uD83C\uDFE0', emojis: ['\uD83C\uDFE0','\uD83D\uDC68\u200D\uD83C\uDF3E','\uD83D\uDC69\u200D\u2695\uFE0F','\uD83D\uDD2E','\uD83D\uDEE1\uFE0F','\u2696\uFE0F','\uD83C\uDFAF','\uD83D\uDC82','\uD83D\uDC74','\uD83D\uDC76','\uD83C\uDFD7\uFE0F','\uD83D\uDD14','\u26EA','\uD83D\uDD6F\uFE0F','\uD83D\uDCA1'] },
      { cat: 'Magie', icon: '\u2728', emojis: ['\u2728','\uD83E\uDDD9','\uD83E\uDDDA','\uD83E\uDDDE','\u2764\uFE0F','\uD83D\uDC9C','\uD83D\uDD25','\u2744\uFE0F','\u26A1','\uD83C\uDF0A','\uD83D\uDCAB','\uD83C\uDF1F','\uD83C\uDF08','\uD83D\uDC8E','\uD83E\uDDEA'] },
      { cat: 'Nuit', icon: '\uD83C\uDF03', emojis: ['\uD83C\uDF03','\uD83C\uDF0C','\uD83C\uDF15','\uD83C\uDF16','\uD83C\uDF17','\uD83C\uDF18','\u2B50','\uD83D\uDD2D','\uD83E\uDD89','\uD83E\uDD87','\uD83D\uDC08\u200D\u2B1B','\uD83D\uDC00','\uD83D\uDD78\uFE0F','\uD83D\uDC7B','\uD83D\uDC7D'] },
      { cat: 'Objets', icon: '\uD83D\uDEE0\uFE0F', emojis: ['\uD83D\uDEE0\uFE0F','\u2692\uFE0F','\uD83D\uDD28','\uD83D\uDCA3','\uD83C\uDFF9','\uD83D\uDD2B','\uD83D\uDC8D','\uD83D\uDC51','\uD83C\uDFC6','\uD83C\uDFAF','\uD83D\uDCDC','\uD83D\uDCD6','\uD83D\uDD11','\u26D3\uFE0F','\uD83E\uDE9E'] },
      { cat: 'Animaux', icon: '\uD83D\uDC3E', emojis: ['\uD83D\uDC0D','\uD83E\uDD85','\uD83E\uDD89','\uD83D\uDC26','\uD83E\uDD8B','\uD83D\uDC1D','\uD83D\uDC22','\uD83D\uDC0A','\uD83E\uDD81','\uD83D\uDC2F','\uD83D\uDC3A','\uD83E\uDD8A','\uD83D\uDC3B','\uD83E\uDDA8','\uD83E\uDD8E'] },
      { cat: 'Visages', icon: '\uD83D\uDE08', emojis: ['\uD83D\uDE08','\uD83D\uDC7F','\uD83D\uDC7B','\uD83D\uDCA0','\uD83E\uDD21','\uD83D\uDE4A','\uD83D\uDE2E','\uD83D\uDE31','\uD83E\uDD2B','\uD83E\uDD14','\uD83D\uDE0E','\uD83E\uDD2F','\uD83E\uDD75','\uD83E\uDD76','\uD83D\uDE35'] },
      { cat: 'Symboles', icon: '\u2620\uFE0F', emojis: ['\u2620\uFE0F','\u2622\uFE0F','\u2623\uFE0F','\u269B\uFE0F','\u267E\uFE0F','\u2716\uFE0F','\u2714\uFE0F','\u26A0\uFE0F','\uD83D\uDD34','\uD83D\uDFE3','\u26AB','\uD83D\uDFE0','\uD83D\uDD35','\uD83D\uDFE2','\u2B55'] }
    ];

    let activeCat = 0;

    function renderCats() {
      catsBar.innerHTML = '';
      EMOJI_DATA.forEach(function(c, i) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-cat-btn' + (i === activeCat ? ' active' : '');
        btn.textContent = c.icon;
        btn.title = c.cat;
        btn.addEventListener('click', function() {
          activeCat = i;
          renderCats();
          renderGrid();
          searchInput.value = '';
        });
        catsBar.appendChild(btn);
      });
    }

    function renderGrid(filter) {
      grid.innerHTML = '';
      const cats = filter
        ? EMOJI_DATA.map(function(c) { return { cat: c.cat, emojis: c.emojis.filter(function() { return true; }) }; })
        : [EMOJI_DATA[activeCat]];

      let emojis;
      if (filter) {
        emojis = [];
        EMOJI_DATA.forEach(function(c) {
          c.emojis.forEach(function(e) { emojis.push(e); });
        });
      } else {
        emojis = EMOJI_DATA[activeCat].emojis;
      }

      emojis.forEach(function(emoji) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'emoji-grid-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', function() {
          selectEmoji(emoji);
        });
        grid.appendChild(btn);
      });
    }

    function selectEmoji(emoji) {
      preview.textContent = emoji;
      hiddenInput.value = emoji;
      dropdown.style.display = 'none';
      trigger.classList.add('emoji-picker-selected');
    }

    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = dropdown.style.display !== 'none';
      dropdown.style.display = isOpen ? 'none' : '';
      if (!isOpen) {
        renderCats();
        renderGrid();
        searchInput.value = '';
        searchInput.focus();
      }
    });

    searchInput.addEventListener('input', function() {
      var q = searchInput.value.trim().toLowerCase();
      if (!q) { renderGrid(); return; }
      grid.innerHTML = '';
      EMOJI_DATA.forEach(function(c) {
        if (c.cat.toLowerCase().includes(q)) {
          c.emojis.forEach(function(emoji) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'emoji-grid-btn';
            btn.textContent = emoji;
            btn.addEventListener('click', function() { selectEmoji(emoji); });
            grid.appendChild(btn);
          });
        }
      });
    });

    dropdown.addEventListener('click', function(e) {
      e.stopPropagation();
    });

    document.addEventListener('click', function(e) {
      if (!trigger.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  })();

  // ═══════════════════════════════════════════════════
  // Strategic Profile — Live Analysis
  // ═══════════════════════════════════════════════════
  const SE = typeof StrategicEngine !== 'undefined' ? StrategicEngine : null;

  const stratEmpty = document.getElementById('strat-empty');
  const stratContent = document.getElementById('strat-content');
  const stratPowerLine = document.getElementById('strat-power-line');
  const stratOrientLine = document.getElementById('strat-orient-line');
  const stratRiskLine = document.getElementById('strat-risk-line');

  function updateStrategicProfile() {
    if (!SE || !stratContent) return;

    // Collect all abilities from cards
    const cards = container.querySelectorAll('.ability-card');
    const abilities = [];
    cards.forEach(card => {
      const ab = readAbilityFromCard(card);
      if (ab && ab.effect) abilities.push(ab);
    });

    if (abilities.length === 0) {
      if (stratEmpty) stratEmpty.style.display = '';
      if (stratContent) stratContent.style.display = 'none';
      return;
    }

    if (stratEmpty) stratEmpty.style.display = 'none';
    if (stratContent) stratContent.style.display = '';

    const roleContext = {
      camp: campSelect.value,
      winCondition: winSelect.value,
    };

    const analysis = SE.analyze(abilities, roleContext);

    // ── Compact profile lines ──
    // Map strategic engine labels (French) to i18n keys
    const TIER_KEYS = { 'Faible': 'strat.tier_weak', 'Modéré': 'strat.tier_moderate', 'Standard': 'strat.tier_standard', 'Puissant': 'strat.tier_powerful', 'Extrême': 'strat.tier_extreme', 'N/A': 'strat.tier_na' };
    const ORIENT_KEYS = { 'Offensif': 'strat.orient_aggressive', 'Défensif': 'strat.orient_defensive', 'Information': 'strat.orient_information', 'Contrôle': 'strat.orient_control', 'Chaos': 'strat.orient_chaos', 'Hybride': 'strat.orient_hybrid', 'Support': 'strat.orient_support', 'Non défini': 'strat.orient_none' };
    const RISK_KEYS = { 'Aucun': 'strat.risk_none', 'Faible': 'strat.risk_low', 'Modéré': 'strat.risk_moderate', 'Élevé': 'strat.risk_high', 'Critique': 'strat.risk_critical' };

    if (stratPowerLine) {
      const tierLabel = t(TIER_KEYS[analysis.power.tier] || analysis.power.tier);
      stratPowerLine.textContent = '⚡ ' + t('strat.power_label') + ' : ' + tierLabel + ' (' + analysis.power.score.toFixed(1) + '/10)';
    }

    if (stratOrientLine) {
      const orientRaw = analysis.orientation.meta.label || 'Non défini';
      const orientLabel = t(ORIENT_KEYS[orientRaw] || orientRaw);
      stratOrientLine.textContent = '🎯 ' + t('strat.orient_label') + ' : ' + orientLabel;
    }

    if (stratRiskLine) {
      const riskLabel = t(RISK_KEYS[analysis.risk.level] || analysis.risk.level);
      stratRiskLine.textContent = '⚠ ' + t('strat.risk_label') + ' : ' + riskLabel;
    }
  }

  // Init
  updateAbilityUI();
})();
