/**
 * Auth routes — Discord OAuth2
 */
const express = require('express');
const passport = require('passport');
const router = express.Router();

// Guard: check if discord strategy is registered
function ensureStrategy(req, res, next) {
  if (!passport._strategy('discord')) {
    return res.status(503).render('error', {
      title: 'OAuth2 Disabled',
      message: 'Discord OAuth2 is not configured. Set CLIENT_SECRET in your .env file to enable login.'
    });
  }
  next();
}

// Discord OAuth2 login
router.get('/discord', ensureStrategy, passport.authenticate('discord'));

// OAuth2 callback
router.get('/discord/callback', ensureStrategy,
  passport.authenticate('discord', { failureRedirect: '/auth/failed' }),
  (req, res) => {
    res.redirect(req.session.returnTo || '/');
    delete req.session.returnTo;
  }
);

// Logout
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

// Auth failed
router.get('/failed', (req, res) => {
  res.status(401).render('error', { title: 'Auth Failed', message: 'Discord authentication failed. Please try again.' });
});

module.exports = router;
