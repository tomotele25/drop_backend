const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/riders");
const authorizeRole = require("../middleware/role");
const { getPricing, updatePricing } = require("../controller/pricing");

router.get("/admin/pricing", authenticateToken, authorizeRole("admin"), getPricing);
router.patch("/admin/pricing", authenticateToken, authorizeRole("admin"), updatePricing);

module.exports = router;
