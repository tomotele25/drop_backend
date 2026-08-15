const express = require("express");
const router = express.Router();
const { paystackWebhook } = require("../controller/payment");

// Body is parsed as raw Buffer (mounted with express.raw() in api/server.js,
// ahead of the global express.json()) — signature verification needs the
// exact bytes Paystack signed, not a re-serialized JSON object.
router.post("/paystack/webhook", paystackWebhook);

module.exports = router;
