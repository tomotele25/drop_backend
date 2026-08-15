const mongoose = require("mongoose");

// One immutable row per completed, paid ride. Never edit a row after
// creation — adjustments (disputes/reversals) are new rows, not mutations.
// This is the source of truth for "why wasn't this driver paid?" and for
// the daily batch settlement job.
const driverEarningSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },

    ride: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ride",
      required: true,
      unique: true, // guarantees exactly one ledger row per ride, even under retries/duplicate triggers
    },

    grossAmount: {
      type: Number,
      required: true,
    },

    commissionRate: {
      type: Number,
      required: true,
    },

    commissionAmount: {
      type: Number,
      required: true,
    },

    netEarning: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "included_in_batch", "paid", "failed"],
      default: "pending",
    },

    payoutBatch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayoutBatch",
      default: null,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    payoutAttempts: {
      type: Number,
      default: 0,
    },

    failureReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

driverEarningSchema.index({ driver: 1, status: 1 });

module.exports = mongoose.model("DriverEarning", driverEarningSchema);
