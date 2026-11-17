
const express = require("express");
const router = express.Router();

const {
  getMessages,
  sendMessage,
  clearChat,
} = require("../controllers/messageController");

const authMiddleware = require("../middleware/authMiddleware");

router.get("/:userId", authMiddleware, getMessages);
router.delete("/:userId", authMiddleware, clearChat);
router.post("/", authMiddleware, sendMessage);

module.exports = router;
