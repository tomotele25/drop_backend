const express = require("express");
const router = express.Router();
const { getVapidPublicKey, subscribe, unsubscribe } = require("../controller/push");
const { expoSubscribe, expoUnsubscribe } = require("../controller/expoPush");
const { authenticateToken } = require("../middleware/riders");

router.get("/push/vapid-public-key", getVapidPublicKey);
router.post("/push/subscribe", authenticateToken, subscribe);
router.post("/push/unsubscribe", authenticateToken, unsubscribe);
router.post("/push/expo-subscribe", authenticateToken, expoSubscribe);
router.post("/push/expo-unsubscribe", authenticateToken, expoUnsubscribe);

module.exports = router;
