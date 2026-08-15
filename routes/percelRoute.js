const express = require("express");
const router = express.Router();
const {sendPackage} = require("../controller/percel")
const { authenticateToken } = require("../middleware/riders")
const { bookingLimiter } = require("../middleware/rateLimit")
const upload = require("../middleware/upload")



router.post("/percel", authenticateToken, bookingLimiter, upload.single("image"), sendPackage)

module.exports = router