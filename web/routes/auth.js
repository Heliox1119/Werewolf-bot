/**
 * Auth routes — Discord OAuth2
 */
const express = require('express');
const passport = require('passport');
const router = express.Router();

// Discord OAuth2 login
router.get('/discord', passport.authenticate('discord'));

// OAuth2 callback
router.get('/discord/callback',
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
