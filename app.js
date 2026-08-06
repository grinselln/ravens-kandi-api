require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const passport = require("./config/passport");

const { sequelize, testConnection } = require("./config/database");
const SequelizeStore = require("connect-session-sequelize")(session.Store);

const sessionStore = new SequelizeStore({ db: sequelize });

const app = express();
app.set("trust proxy", 1);

app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

const authRoutes = require("./routes/auth");
const photoRoutes = require("./routes/photos");
const typeRoutes = require("./routes/types");
const categoryRoutes = require("./routes/categories");
const subcategoryRoutes = require("./routes/subcategories");
const contactRoutes = require("./routes/contact");

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/auth", authRoutes);
app.use("/photos", photoRoutes);
app.use("/types", typeRoutes);
app.use("/categories", categoryRoutes);
app.use("/subcategories", subcategoryRoutes);
app.use("/contact", contactRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.redirect(process.env.CLIENT_URL + '/login?error=connection');
});

const PORT = process.env.PORT || 3000;
const startServer = async () => {
  await testConnection();
  await sessionStore.sync();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

startServer(); 