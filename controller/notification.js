const Notification = require("../model/notification");

const getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    const unreadCount = await Notification.countDocuments({ user: req.user.id, read: false });

    return res.status(200).json({ success: true, notifications, unreadCount });
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, user: req.user.id },
      { read: true },
      { new: true },
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    return res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const markAllNotificationsRead = async (req, res) => {
  try {
    await Notification.updateMany({ user: req.user.id, read: false }, { read: true });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getNotifications, markNotificationRead, markAllNotificationsRead };
