const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/riders");
const authorizeRole = require("../middleware/role");
const { getBanks, updateBankDetails } = require("../controller/rider");
const {
  triggerSettlement,
  getPayoutBatches,
  getDriverEarnings,
} = require("../controller/payout");

// Driver-facing
router.get("/rider/banks", authenticateToken, getBanks);
router.post("/rider/bank-details", authenticateToken, updateBankDetails);
router.get("/rider/earnings", authenticateToken, getDriverEarnings);

// Admin-facing
router.post("/admin/payouts/run", authenticateToken, authorizeRole("admin"), triggerSettlement);
router.get("/admin/payouts", authenticateToken, authorizeRole("admin"), getPayoutBatches);

module.exports = router;
