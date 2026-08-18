const express = require("express");
const router = express.Router();
const { signup, login, updateProfile, deleteAccount } = require("../controller/auth");
const { authLimiter } = require("../middleware/rateLimit");
const { authenticateToken } = require("../middleware/riders");

router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);
router.patch("/me", authenticateToken, updateProfile);
router.delete("/me", authenticateToken, deleteAccount);

module.exports = router;
