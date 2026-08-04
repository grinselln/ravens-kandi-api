const rateLimit = require("express-rate-limit");

const viewLimiter = rateLimit.rateLimit({
  windowMs: 5 * 60 * 1000, //5 minutes
  max: 1,
  keyGenerator: (req) => {
    const photoId = req.params.id || "default";
    return `${req.ip}-${photoId}`;
  },
  handler: (req, res) => {
    res.status(200).json({ message: "OK" });
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = viewLimiter;
