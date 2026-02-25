/**
 * 🐺 Roles Page — Camp filtering, card flip, custom role management
 */
(function() {
  'use strict';

  // === Camp Filter ===
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

        // Hide sections where all cards are hidden (but not custom section)
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

  // === Flip All Cards ===
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

  // === Create Role ===
  const form = document.getElementById('create-role-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());

      try {
        const res = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
          location.reload();
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Failed to create role: ' + err.message);
      }
    });
  }

  // === Delete Roles ===
  document.querySelectorAll('.delete-role').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this custom role?')) return;
      const roleId = btn.dataset.roleId;
      try {
        const res = await fetch(`/api/roles/${roleId}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
          btn.closest('.role-card').remove();
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Failed to delete role: ' + err.message);
      }
    });
  });
})();
