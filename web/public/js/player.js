/**
 * Player Profile Page — Client JS
 * Counter animations, achievement tab filtering, ELO bar animation
 */
(function () {
  'use strict';

  /* ── Animated Counters ── */
  function animateCounters() {
    document.querySelectorAll('.pp-metric-val[data-target]').forEach(el => {
      const target = parseInt(el.dataset.target, 10) || 0;
      const isPct = el.classList.contains('pp-metric-pct');
      const duration = 1400;
      const start = performance.now();

      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // ease-out cubic
        const ease = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(ease * target);
        el.textContent = current.toLocaleString('fr-FR') + (isPct ? '%' : '');
        if (progress < 1) requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }

  /* ── ELO bar animation ── */
  function animateEloBar() {
    const fill = document.querySelector('.pp-elo-fill');
    if (!fill) return;
    const targetWidth = fill.style.width;
    fill.style.width = '0%';
    fill.style.transition = 'width 1.8s cubic-bezier(0.16, 1, 0.3, 1)';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fill.style.width = targetWidth;
      });
    });
  }

  /* ── Role bar animations ── */
  function animateRoleBars() {
    document.querySelectorAll('.pp-role-bar-fill').forEach(fill => {
      const targetWidth = fill.style.width;
      fill.style.width = '0%';
      fill.style.transition = 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fill.style.width = targetWidth;
        });
      });
    });
  }

  /* ── Achievement progress bars ── */
  function animateAchBars() {
    // No longer needed — kept as no-op
  }

  /* ── Achievement global progress ── */
  function animateGlobalProgress() {
    // No longer needed — kept as no-op
  }

  /* ── Achievement Tab Filtering — removed (simplified section) ── */
  function initAchTabs() {}

  /* ── Intersection Observer for scroll-in ── */
  function initScrollReveal() {
    if (!('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('pp-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.pp-panel, .pp-ach-section, .pp-recent-section').forEach(el => {
      observer.observe(el);
    });
  }

  /* ── Init ── */
  function init() {
    animateCounters();
    animateEloBar();
    animateRoleBars();
    animateAchBars();
    animateGlobalProgress();
    initAchTabs();
    initScrollReveal();
  }

  // Run immediately if DOM already loaded (PJAX navigation), or wait for DOMContentLoaded (full page load)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Small delay to ensure the injected HTML is fully in the DOM
    setTimeout(init, 10);
  }
})();
