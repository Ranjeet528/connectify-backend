const express = require("express");
const router = express.Router();

const {
  createOrGetConversation,
  getConversations,
  deleteConversation,
} = require("../controllers/conversationController");

const authMiddleware = require("../middleware/authMiddleware");

router.get("/", authMiddleware, getConversations);
router.post("/", authMiddleware, createOrGetConversation);
router.delete("/:userId", authMiddleware, deleteConversation);

module.exports = router;
