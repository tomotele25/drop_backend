const DriverEarning = require("../model/driverEarning");
const DriverCommission = require("../model/driverCommission");
const PayoutBatch = require("../model/payoutBatch");
const Rider = require("../model/rider");
const { initiateTransfer } = require("../utils/paystack");
const { MAX_PAYOUT_ATTEMPTS } = require("../config/earnings");

// The daily settlement run: batches every driver's unpaid earnings since
// the last run and sends one transfer per driver via Paystack. Designed to
// be safe to call more than once — earnings are claimed into the batch
// atomically before any transfer is attempted, so a second concurrent run
// (or a retry) can't double-pay the same ride.
const runDailySettlement = async () => {
  const batch = await PayoutBatch.create({ runDate: new Date(), status: "processing" });

  // Claim every settleable row into this batch up front. "Settleable" means
  // never-attempted (pending) or previously failed but still under the
  // retry cap — claiming happens via an atomic updateMany so two settlement
  // runs racing each other can't both grab the same row.
  const claimable = await DriverEarning.find({
    $or: [
      { status: "pending" },
      { status: "failed", payoutAttempts: { $lt: MAX_PAYOUT_ATTEMPTS } },
    ],
  });

  const claimableIds = claimable.map((e) => e._id);
  if (claimableIds.length === 0) {
    batch.status = "completed";
    await batch.save();
    return batch;
  }

  await DriverEarning.updateMany(
    { _id: { $in: claimableIds } },
    { status: "included_in_batch", payoutBatch: batch._id },
  );

  const entries = await DriverEarning.find({ _id: { $in: claimableIds } });
  const byDriver = new Map();
  for (const entry of entries) {
    const key = entry.driver.toString();
    if (!byDriver.has(key)) byDriver.set(key, []);
    byDriver.get(key).push(entry);
  }

  let totalAmount = 0;
  let succeededCount = 0;
  let failedCount = 0;

  for (const [driverId, driverEntries] of byDriver) {
    const amount = driverEntries.reduce((sum, e) => sum + e.netEarning, 0);
    const entryIds = driverEntries.map((e) => e._id);

    const rider = await Rider.findById(driverId).select("paystackRecipientCode");

    if (!rider?.paystackRecipientCode) {
      await DriverEarning.updateMany(
        { _id: { $in: entryIds } },
        {
          status: "failed",
          failureReason: "No payout bank details on file",
          $inc: { payoutAttempts: 1 },
        },
      );
      failedCount++;
      continue;
    }

    try {
      await initiateTransfer({
        amountNaira: amount,
        recipientCode: rider.paystackRecipientCode,
        reference: `PAYOUT-${batch._id}-${driverId}`,
        reason: "Daily driver settlement",
      });

      await DriverEarning.updateMany(
        { _id: { $in: entryIds } },
        { status: "paid", paidAt: new Date() },
      );

      totalAmount += amount;
      succeededCount++;
    } catch (error) {
      const reason = error?.response?.data?.message || error.message;
      console.error(`❌ Payout failed for driver ${driverId}: ${reason}`);

      // Revert to "pending" so the next run retries automatically, unless
      // this has already exhausted its retry attempts.
      const attemptsNow = (driverEntries[0].payoutAttempts || 0) + 1;
      await DriverEarning.updateMany(
        { _id: { $in: entryIds } },
        {
          status: attemptsNow >= MAX_PAYOUT_ATTEMPTS ? "failed" : "pending",
          failureReason: reason,
          $inc: { payoutAttempts: 1 },
        },
      );
      failedCount++;
    }
  }

  batch.driverCount = byDriver.size;
  batch.totalAmount = totalAmount;
  batch.succeededCount = succeededCount;
  batch.failedCount = failedCount;
  batch.status = failedCount > 0 ? "completed_with_errors" : "completed";
  await batch.save();

  console.log(
    `💰 Payout batch ${batch._id}: ${succeededCount} paid, ${failedCount} failed, ₦${totalAmount} total`,
  );

  return batch;
};

// Admin-triggered manual run (also used by the daily cron).
const triggerSettlement = async (req, res) => {
  try {
    const batch = await runDailySettlement();
    return res.status(200).json({ success: true, batch });
  } catch (error) {
    console.error("Manual settlement run error:", error);
    return res.status(500).json({ success: false, message: "Settlement run failed" });
  }
};

const getPayoutBatches = async (_req, res) => {
  try {
    const batches = await PayoutBatch.find().sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, batches });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Driver-facing earnings summary — server-computed, not summed client-side
// from raw trip data (which is timezone/clock-skew fragile). Also includes
// commission owed from cash/transfer rides, since both live on the same
// earnings page.
const getDriverEarnings = async (req, res) => {
  try {
    if (!req.user?.riderId) {
      return res.status(403).json({ success: false, message: "Drivers only" });
    }

    const driverId = req.user.riderId;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayEntries, allEntries, recent, pendingCommissions, recentCommissions] =
      await Promise.all([
        DriverEarning.find({ driver: driverId, createdAt: { $gte: startOfToday } }),
        DriverEarning.find({ driver: driverId }),
        DriverEarning.find({ driver: driverId }).sort({ createdAt: -1 }).limit(20),
        DriverCommission.find({ driver: driverId, status: "pending" }),
        DriverCommission.find({ driver: driverId }).sort({ createdAt: -1 }).limit(20),
      ]);

    const sum = (rows) => rows.reduce((s, r) => s + r.netEarning, 0);
    const sumCommission = (rows) => rows.reduce((s, r) => s + r.commissionAmount, 0);

    return res.status(200).json({
      success: true,
      earningsToday: sum(todayEntries),
      tripsToday: todayEntries.length,
      totalEarned: sum(allEntries.filter((e) => e.status === "paid")),
      pendingPayout: sum(allEntries.filter((e) => e.status !== "paid")),
      recent,
      // Cash/transfer rides: what this driver owes the platform, not what
      // the platform owes them.
      commissionOwed: sumCommission(pendingCommissions),
      recentCommissions,
    });
  } catch (error) {
    console.error("Get driver earnings error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin view — every driver currently carrying a commission debt, so you
// know who to chase for settlement.
const getOutstandingCommissions = async (_req, res) => {
  try {
    const pending = await DriverCommission.find({ status: "pending" }).populate(
      "driver",
      "fullname plateNo contact",
    );

    const byDriver = new Map();
    for (const entry of pending) {
      const key = entry.driver?._id?.toString();
      if (!key) continue;
      if (!byDriver.has(key)) {
        byDriver.set(key, { driver: entry.driver, totalOwed: 0, rideCount: 0 });
      }
      const bucket = byDriver.get(key);
      bucket.totalOwed += entry.commissionAmount;
      bucket.rideCount += 1;
    }

    return res.status(200).json({ success: true, drivers: Array.from(byDriver.values()) });
  } catch (error) {
    console.error("Get outstanding commissions error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin marks a driver's outstanding commission as settled once they've
// actually transferred it — manual by design, same as the driver-owes-
// platform direction has no gateway integration (yet) either.
const settleDriverCommission = async (req, res) => {
  try {
    const { driverId } = req.params;
    if (!driverId) {
      return res.status(400).json({ success: false, message: "driverId is required" });
    }

    const result = await DriverCommission.updateMany(
      { driver: driverId, status: "pending" },
      { status: "settled", settledAt: new Date(), settledBy: req.user?.id },
    );

    return res.status(200).json({
      success: true,
      message: `Settled ${result.modifiedCount} commission entr${result.modifiedCount === 1 ? "y" : "ies"}`,
      settledCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Settle driver commission error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  runDailySettlement,
  triggerSettlement,
  getPayoutBatches,
  getDriverEarnings,
  getOutstandingCommissions,
  settleDriverCommission,
};
