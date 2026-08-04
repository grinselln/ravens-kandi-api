const express = require("express");
const router = express.Router();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

router.post("/", async (req, res) => {
  const { name, email, topic, message } = req.body;

  if (!name || !email || !topic || !message) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    await transporter.sendMail({
      from: `"${name}" <${process.env.SMTP_USER}>`,
      to: process.env.CONTACT_RECIPIENT,
      replyTo: email,
      subject: `Contact Submission | ${topic}`,
      text: message,
    });

    res.json({ message: "Message sent successfully." });
  } catch (error) {
    console.error("Email error:", error);
    res.status(500).json({ message: "Failed to send message." });
  }
});

module.exports = router;