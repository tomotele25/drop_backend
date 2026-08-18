// One-off CLI diagnostic for the "driver got no ride notification" report.
// Checks, in one command, every prerequisite `dispatchRideToDrivers`
// (controller/rides.js) needs to reach a given driver, instead of running
// four separate manual DB queries each time this comes up.
//
// Usage: node scripts/diagnoseDriver.js <riderId-or-userId>
require("dotenv").config();
const mongoose = require("mongoose");
const Rider = require("../model/rider");
const ExpoPushToken = require("../model/expoPushToken");
const PushSubscription = require("../model/pushSubscription");

async function main() {
  const idArg = process.argv[2];
  if (!idArg) {
    console.error("Usage: node scripts/diagnoseDriver.js <riderId-or-userId>");
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URL, {
    serverSelectionTimeoutMS: 15000,
  });

  const rider =
    (await Rider.findById(idArg).catch(() => null)) ||
    (await Rider.findOne({ user: idArg }));

  if (!rider) {
    console.log(`No Rider (driver) document found for id "${idArg}" as either a Rider _id or a user ref.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nDriver: ${rider._id}`);
  console.log(`  user field set:        ${rider.user ? `yes (${rider.user})` : "❌ NO — no push channel is possible for this driver"}`);
  console.log(`  isActive:               ${rider.isActive ? "yes" : "❌ NO — will not be matched by findAvailableNearbyDrivers"}`);
  console.log(`  location (geo):         ${JSON.stringify(rider.location?.coordinates ?? "unset")}`);
  console.log(`  currentLocation:        lat=${rider.currentLocation?.latitude}, lng=${rider.currentLocation?.longitude}`);

  if (rider.location?.coordinates?.[0] === 0 && rider.location?.coordinates?.[1] === 0) {
    console.log(`  ⚠️  location is stuck at [0,0] — will silently fail $near matching regardless of currentLocation.`);
  }

  if (rider.user) {
    const expoTokens = await ExpoPushToken.find({ user: rider.user });
    const webSubs = await PushSubscription.find({ user: rider.user });
    console.log(`  Expo push tokens:       ${expoTokens.length}`);
    console.log(`  Web push subscriptions: ${webSubs.length}`);
    if (expoTokens.length === 0 && webSubs.length === 0) {
      console.log(`  ❌ No push channel registered at all — driver app/site never completed push subscription for this user.`);
    }
  }

  console.log("");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Diagnostic script failed:", err);
  process.exit(1);
});
