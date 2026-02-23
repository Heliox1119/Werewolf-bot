/**
 * 🐺 Roles Editor — Custom role management
 */
(function() {
  'use strict';

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
