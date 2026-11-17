
const express = require("express");
const multer = require("multer");

const authMiddleware = require("../middleware/authMiddleware");
const { uploadMedia } = require("../controllers/mediaController");

const router = express.Router();

const allowedMimeTypes = [
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",

  // Videos
  "video/mp4",
  "video/webm",
  "video/quicktime",

  // Audio and voice
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/3gpp",
  "audio/x-m4a",

  // Documents
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Archives
  "application/zip",
  "application/x-zip-compressed",
];

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 50 * 1024 * 1024,
  },

  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "File type not allowed. Upload supported images, videos, audio or documents."
        )
      );
    }
  },
});

router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  uploadMedia
);

module.exports = router;
