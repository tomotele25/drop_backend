const ExpoPushToken = require("../model/expoPushToken");
const Notification = require("../model/notification");

// expo-server-sdk is optional — if it's not installed (or the app hasn't
// added Expo mobile support yet), push over Expo just silently no-ops,
// mirroring how utils/webpush.js degrades when VAPID isn't configured.
let Expo;
let expoConfigured = false;
try {
  ({ Expo } = require("expo-server-sdk"));
  expoConfigured = true;
} catch (err) {
  console.warn(
    "⚠️ expo-server-sdk not installed — Expo push notifications disabled, rest of the app is unaffected.",
  );
}

const expoClient = expoConfigured ? new Expo() : null;

// Sends an Expo push notification to every registered device for a user.
// Fire-and-forget, same contract as sendPushToUser in utils/webpush.js —
// call both from the same dispatch site so a driver/customer with a mobile
// app gets a native push while a browser-only user still gets Web Push.
const sendExpoPushToUser = async (userId, payload) => {
  // Log regardless of push-delivery outcome, so the in-app Notifications
  // tab has a record even if the device missed the actual push.
  Notification.create({
    user: userId,
    title: payload.title,
    body: payload.body,
    url: payload.url ?? null,
    rideId: payload.rideId ?? null,
  }).catch((err) => console.error("Notification log write failed:", err.message));

  if (!expoConfigured) return { sent: 0 };

  const tokens = await ExpoPushToken.find({ user: userId });
  if (tokens.length === 0) return { sent: 0 };

  const messages = [];
  for (const record of tokens) {
    if (!Expo.isExpoPushToken(record.token)) {
      await ExpoPushToken.deleteOne({ _id: record._id });
      continue;
    }
    messages.push({
      to: record.token,
      sound: "default",
      title: payload.title,
      body: payload.body,
      data: { url: payload.url, rideId: payload.rideId },
    });
  }

  if (messages.length === 0) return { sent: 0 };

  let sent = 0;
  const chunks = expoClient.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expoClient.sendPushNotificationsAsync(chunk);
      sent += tickets.filter((t) => t.status === "ok").length;
      // DeviceNotRegistered tickets mean the token is dead (app uninstalled) —
      // clean those up so we stop retrying them.
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          await ExpoPushToken.deleteOne({ token: chunk[i].to });
        }
      }
    } catch (err) {
      console.error(`Expo push send failed for user ${userId}:`, err.message);
    }
  }

  return { sent };
};

module.exports = { sendExpoPushToUser };
