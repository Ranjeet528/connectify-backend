const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const { getCallHistory, getTurnCredentials, clearCallHistory } = require("../controllers/callController");

router.get("/", authMiddleware, getCallHistory);
router.delete("/", authMiddleware, clearCallHistory);
router.get("/turn-credentials", authMiddleware, getTurnCredentials);

module.exports = router;
