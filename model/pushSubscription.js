const mongoose = require("mongoose");

// One row per browser/device push subscription. A driver logged in on two
// devices gets two rows — both receive the push. Endpoint is unique since
// the browser's push service issues a fresh one if the old subscription
// expires or the driver re-subscribes.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true },
);

pushSubscriptionSchema.index({ user: 1 });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);
