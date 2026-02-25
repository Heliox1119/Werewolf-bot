/**
 * 🐺 Roles Editor — Custom role management
 */
(function() {
  'use strict';

  // === Flip All Cards ===
  const flipBtn = document.getElementById('btn-flip-all');
  if (flipBtn) {
    let isFlipped = false;
    let animating = false;

    flipBtn.addEventListener('click', () => {
      if (animating) return;
      animating = true;

      const cards = document.querySelectorAll('.role-img-inner');
      const target = !isFlipped; // true = reveal, false = hide
      const delay = 80; // ms between each card

      cards.forEach((card, i) => {
        setTimeout(() => {
          if (target) {
            card.classList.remove('unflipped');
            card.classList.add('flipped');
          } else {
            card.classList.remove('flipped');
            card.classList.add('unflipped');
            // Remove unflipped class after animation so hover works normally again
            card.addEventListener('transitionend', function handler() {
              card.classList.remove('unflipped');
              card.removeEventListener('transitionend', handler);
            });
          }
          // Last card: update state
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
