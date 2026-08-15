const mongoose = require("mongoose");

// One row per daily settlement run — lets us answer "which batch did this
// driver's payout go out in, and did the whole run succeed?"
const payoutBatchSchema = new mongoose.Schema(
  {
    runDate: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: ["processing", "completed", "completed_with_errors"],
      default: "processing",
    },

    driverCount: {
      type: Number,
      default: 0,
    },

    totalAmount: {
      type: Number,
      default: 0,
    },

    succeededCount: {
      type: Number,
      default: 0,
    },

    failedCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PayoutBatch", payoutBatchSchema);
