const express = require("express");
const router = express.Router();
const { signup, login } = require("../controller/auth");
const { authLimiter } = require("../middleware/rateLimit");

router.post("/signup", authLimiter, signup);
router.post("/login", authLimiter, login);

module.exports = router;
