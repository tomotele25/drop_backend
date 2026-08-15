const express = require("express");
const router = express.Router();
const {
  getWallet,
  initializeWalletFunding,
  getTransactionHistory,
} = require("../controller/wallet");
const { authenticateToken } = require("../middleware/riders");
const { bookingLimiter } = require("../middleware/rateLimit");

router.get("/wallet", authenticateToken, getWallet);
router.post("/wallet/fund/initialize", authenticateToken, bookingLimiter, initializeWalletFunding);
router.get("/wallet/transactions", authenticateToken, getTransactionHistory);

module.exports = router;
