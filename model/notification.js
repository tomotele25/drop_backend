const mongoose = require("mongoose");

// In-app record of every push notification sent to a user, so the mobile
// app has something to show in a Notifications tab even if the device
// missed the actual push (app closed, notifications disabled, etc).
// Written alongside every sendExpoPushToUser call, not a replacement for it.
const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      default: null,
    },
    rideId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      default: null,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

notificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
