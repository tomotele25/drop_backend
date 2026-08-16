const mongoose = require("mongoose");

// Parallel to PushSubscription (VAPID/web push) — this stores Expo push
// tokens for native mobile clients. One row per device; a user logged in on
// two devices gets two rows, both receive the push. Kept as a separate model
// rather than a field on PushSubscription since the shapes don't overlap
// (no endpoint/keys pair for Expo tokens) and this keeps the existing VAPID
// path completely untouched.
const expoPushTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    deviceType: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

expoPushTokenSchema.index({ user: 1 });

module.exports = mongoose.model("ExpoPushToken", expoPushTokenSchema);
