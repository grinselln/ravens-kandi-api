const multer = require("multer");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

const UPLOAD_DIR = path.join(__dirname, "..", process.env.UPLOAD_DIR || "uploads");
const MAX_FILE_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, WebP, and GIF images are allowed."), false);
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});

const processAndSaveImage = async (buffer, originalName) => {
  const timestamp = Date.now();
  const baseName = path.parse(originalName).name.replace(/\s+/g, "-").toLowerCase();
  const filename = `${baseName}-${timestamp}.webp`;
  const outputPath = path.join(UPLOAD_DIR, filename);

  await sharp(buffer)
    .resize({ width: 1800, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath);

  return filename;
};

const deleteImageFile = async (filename) => {
  if (!filename) return;
  const filePath = path.join(UPLOAD_DIR, filename);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      // Already gone — not an error worth surfacing.
      return;
    }
    throw error;
  }
};

module.exports = { upload, processAndSaveImage, deleteImageFile, UPLOAD_DIR };