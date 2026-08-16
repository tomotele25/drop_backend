const express = require("express");
const router = express.Router();
const {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} = require("../controller/notification");
const { authenticateToken } = require("../middleware/riders");

router.get("/notifications", authenticateToken, getNotifications);
router.post("/notifications/:id/read", authenticateToken, markNotificationRead);
router.post("/notifications/read-all", authenticateToken, markAllNotificationsRead);

module.exports = router;
