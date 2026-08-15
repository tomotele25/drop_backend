const webpush = require("web-push");
const PushSubscription = require("../model/pushSubscription");

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// Sends a push notification to every subscribed device for a driver's User
// account. This is the channel that can reach a driver even when the app
// tab isn't focused — the browser's push service wakes the service worker.
// It is NOT a substitute for a real background-location native app; a fully
// closed browser or a phone in deep sleep can still miss it, but it's the
// most a web app can do.
const sendPushToUser = async (userId, payload) => {
  const subscriptions = await PushSubscription.find({ user: userId });
  if (subscriptions.length === 0) return { sent: 0 };

  let sent = 0;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        // 404/410 = the browser's push service considers this subscription
        // dead (uninstalled, permission revoked, expired) — stop trying it.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await PushSubscription.deleteOne({ _id: sub._id });
        } else {
          console.error(`Push send failed for user ${userId}:`, err.message);
        }
      }
    }),
  );

  return { sent };
};

module.exports = { sendPushToUser };
