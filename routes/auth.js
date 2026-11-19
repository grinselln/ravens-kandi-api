const express = require("express");
const router = express.Router();
const passport = require("passport");
const { requireAuth } = require("../middleware/requireAuth");

router.get("/me", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated." });
});

router.get("/google", (req, res, next) => {
  const state = req.query.popup === "true" ? "popup" : "normal";
  passport.authenticate("google", {
    scope: ["email"],
    prompt: "select_account",
    state,
  })(req, res, next);
});

router.get("/google/callback", (req, res, next) => {
  passport.authenticate("google", (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.redirect(process.env.CLIENT_URL + "/login?error=authentication");

    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      if (req.query.state === "popup") {
        return res.send(`
          <script>
            window.opener.postMessage('auth-success', '${process.env.CLIENT_URL}');
            window.close();
          </script>
        `);
      }

      res.redirect(process.env.CLIENT_URL + "/admin");
    });
  })(req, res, next);
});

router.post("/logout", requireAuth, (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ message: "Logout failed" });
    
    req.session.destroy((destroyErr) => {
      if (destroyErr) return res.status(500).json({ message: "Logout failed" });

      res.clearCookie("connect.sid", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      });
      res.status(200).json({ message: "Logged out" });
    });
  });
});

module.exports = router;