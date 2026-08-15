const PushSubscription = require("../model/pushSubscription");

const getVapidPublicKey = (_req, res) => {
  res.status(200).json({ success: true, publicKey: process.env.VAPID_PUBLIC_KEY });
};

const subscribe = async (req, res) => {
  try {
    const { endpoint, keys } = req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ success: false, message: "Invalid subscription" });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user: req.user.id, endpoint, keys },
      { upsert: true, new: true },
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Push subscribe error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const unsubscribe = async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (!endpoint) {
      return res.status(400).json({ success: false, message: "endpoint is required" });
    }
    await PushSubscription.deleteOne({ endpoint, user: req.user.id });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getVapidPublicKey, subscribe, unsubscribe };
