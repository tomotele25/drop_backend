const express = require("express");
const router = express.Router();
const { getVapidPublicKey, subscribe, unsubscribe } = require("../controller/push");
const { authenticateToken } = require("../middleware/riders");

router.get("/push/vapid-public-key", getVapidPublicKey);
router.post("/push/subscribe", authenticateToken, subscribe);
router.post("/push/unsubscribe", authenticateToken, unsubscribe);

module.exports = router;
