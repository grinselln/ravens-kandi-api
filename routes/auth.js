const express = require("express");
const router = express.Router();
const passport = require("passport");
const { requireAdmin } = require("../middleware/requireAuth");

router.get("/me", (req, res) => {
  if (req.isAuthenticated()) {
    return res.json(req.user);
  }
  res.status(401).json({ message: "Not authenticated." });
});

router.get("/google", (req, res, next) => {
  const state = req.query.popup === "true" ? "popup" : "normal";
  passport.authenticate("google", {
    scope: ["profile", "email"],
    state,
  })(req, res, next);
});

router.get("/google/callback",
  passport.authenticate("google", { failureRedirect: "/login?error=authentication" }),
  (req, res) => {
    if (req.query.state === "popup") {
      return res.send(`
        <script>
          window.opener.postMessage('auth-success', '${process.env.CLIENT_URL}');
          window.close();
        </script>
      `);
    }
    res.redirect(process.env.CLIENT_URL + "/admin");
  }
);

router.post("/logout", requireAdmin, (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ message: "Logout failed" });
    res.status(200).json({ message: "Logged out" });
  });
});

module.exports = router;