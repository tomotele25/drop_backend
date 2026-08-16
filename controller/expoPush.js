const ExpoPushToken = require("../model/expoPushToken");

const expoSubscribe = async (req, res) => {
  try {
    const { token, deviceType } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: "token is required" });
    }

    await ExpoPushToken.findOneAndUpdate(
      { token },
      { user: req.user.id, token, deviceType: deviceType ?? null },
      { upsert: true, new: true },
    );

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Expo push subscribe error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const expoUnsubscribe = async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: "token is required" });
    }
    await ExpoPushToken.deleteOne({ token, user: req.user.id });
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { expoSubscribe, expoUnsubscribe };
