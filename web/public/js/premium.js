/**
 * Premium Page — Interactive Effects
 * Golden particle rain, billing toggle, stat counters, role carousel
 */
(function () {
  'use strict';

  /* ═══════ GOLDEN PARTICLE CANVAS ═══════ */
  const canvas = document.getElementById('pm-particles');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let particles = [];
    const PARTICLE_COUNT = 60;

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = document.documentElement.scrollHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    class Particle {
      constructor() { this.reset(true); }
      reset(init) {
        this.x = Math.random() * canvas.width;
        this.y = init ? Math.random() * canvas.height : -10;
        this.size = Math.random() * 2.5 + 0.5;
        this.speedY = Math.random() * 0.5 + 0.15;
        this.speedX = (Math.random() - 0.5) * 0.3;
        this.opacity = Math.random() * 0.5 + 0.2;
        this.golden = Math.random() > 0.3;
      }
      update() {
        this.y += this.speedY;
        this.x += this.speedX;
        this.opacity += (Math.random() - 0.5) * 0.01;
        this.opacity = Math.max(0.1, Math.min(0.7, this.opacity));
        if (this.y > canvas.height + 10) this.reset(false);
      }
      draw() {
        ctx.save();
        ctx.globalAlpha = this.opacity;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        if (this.golden) {
          ctx.fillStyle = '#fbbf24';
          ctx.shadowColor = 'rgba(250, 204, 21, 0.5)';
          ctx.shadowBlur = 6;
        } else {
          ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
          ctx.shadowColor = 'rgba(139, 92, 246, 0.3)';
          ctx.shadowBlur = 4;
        }
        ctx.fill();
        ctx.restore();
      }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) { p.update(); p.draw(); }
      requestAnimationFrame(animate);
    }
    animate();
  }

  /* ═══════ ANIMATED COUNTERS ═══════ */
  const counters = document.querySelectorAll('.pm-stat-val[data-count]');
  function animateCounters() {
    counters.forEach(el => {
      const target = parseInt(el.dataset.count, 10);
      const duration = 1800;
      const start = performance.now();
      function tick(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(target * ease);
        if (progress < 1) requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  // Trigger counters on scroll into view
  if (counters.length) {
    let counted = false;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !counted) {
          counted = true;
          animateCounters();
          obs.disconnect();
        }
      });
    }, { threshold: 0.5 });
    counters.forEach(el => obs.observe(el));
  }

  /* ═══════ BILLING TOGGLE ═══════ */
  const toggle = document.getElementById('pm-billing-switch');
  const badge = document.querySelector('.pm-save-badge');
  const monthlyLabel = document.getElementById('pm-bill-monthly');
  const yearlyLabel = document.getElementById('pm-bill-yearly');
  const priceEls = document.querySelectorAll('.pm-price-amount[data-monthly]');

  if (toggle) {
    let isYearly = false;
    toggle.addEventListener('click', () => {
      isYearly = !isYearly;
      toggle.classList.toggle('active', isYearly);
      if (monthlyLabel) monthlyLabel.classList.toggle('pm-billing-active', !isYearly);
      if (yearlyLabel) yearlyLabel.classList.toggle('pm-billing-active', isYearly);
      if (badge) badge.classList.toggle('visible', isYearly);

      priceEls.forEach(el => {
        const val = isYearly ? el.dataset.yearly : el.dataset.monthly;
        // Animate the number change
        el.style.transform = 'translateY(-4px)';
        el.style.opacity = '0';
        setTimeout(() => {
          el.textContent = val;
          el.style.transform = 'translateY(4px)';
          requestAnimationFrame(() => {
            el.style.transform = 'translateY(0)';
            el.style.opacity = '1';
          });
        }, 150);
      });
    });
  }

  /* ═══════ ROLE CAROUSEL — DUPLICATE FOR INFINITE SCROLL ═══════ */
  const track = document.getElementById('pm-roles-track');
  if (track) {
    const cards = Array.from(track.children);
    // Duplicate cards for seamless loop
    cards.forEach(card => {
      const clone = card.cloneNode(true);
      track.appendChild(clone);
    });

    // Tilt effect on hover
    track.querySelectorAll('.pm-role-card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `translateY(-8px) scale(1.03) rotateY(${x * 8}deg) rotateX(${-y * 8}deg)`;
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = '';
      });
    });
  }

  /* ═══════ SCROLL-REVEAL SECTIONS ═══════ */
  const revealSections = document.querySelectorAll('.pm-compare, .pm-features, .pm-pricing, .pm-social, .pm-faq, .pm-final-cta');
  if (revealSections.length) {
    const revealObs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('pm-revealed');
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    revealSections.forEach(s => {
      s.style.opacity = '0';
      s.style.transform = 'translateY(30px)';
      s.style.transition = 'opacity 0.7s ease, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1)';
      revealObs.observe(s);
    });
  }

  // Apply reveal
  document.addEventListener('scroll', () => {}, { passive: true });
  const style = document.createElement('style');
  style.textContent = '.pm-revealed { opacity: 1 !important; transform: translateY(0) !important; }';
  document.head.appendChild(style);

  /* ═══════ SMOOTH SCROLL FOR ANCHOR LINKS ═══════ */
  document.querySelectorAll('a[href^="#pm-"]').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

})();
