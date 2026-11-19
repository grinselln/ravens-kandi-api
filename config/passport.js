const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { sequelize } = require("./database");
const { QueryTypes } = require("sequelize");

const ADMIN_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(",")
  : [];

const USER_EMAILS = process.env.USER_EMAILS
  ? process.env.USER_EMAILS.split(",")
  : [];

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();

        if (!email || (!ADMIN_EMAILS.includes(email) && !USER_EMAILS.includes(email))) {
          return done(null, false, { message: "Email not authorized." });
        }

        const isAdmin = ADMIN_EMAILS.includes(email);

        const [existing] = await sequelize.query(
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        {
          replacements: [profile.id],
          type: QueryTypes.SELECT,
        }
      );

      if (existing) {
        return done(null, existing);
      }

      await sequelize.query(
        "INSERT INTO users (id, username, role, created_at) VALUES (?, ?, ?, NOW())",
        {
         replacements: [profile.id, profile.displayName ?? "", isAdmin ? "admin" : "user"],
          type: QueryTypes.INSERT,
        }
      );

      const [newUser] = await sequelize.query(
        "SELECT * FROM users WHERE id = ? LIMIT 1",
        {
          replacements: [profile.id],
          type: QueryTypes.SELECT,
        }
      );

      return done(null, newUser);

      
      } catch (error) {
        return done(error);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const [user] = await sequelize.query(
      "SELECT * FROM users WHERE id = ? LIMIT 1",
      {
        replacements: [id],
        type: QueryTypes.SELECT,
      }
    );
    
    done(null, user || null);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;
