const mongoose = require("mongoose");

// The inverse of DriverEarning. For cash/transfer rides, the customer pays
// the driver directly — the platform never touches that money — so instead
// of the platform owing the driver a payout, the driver owes the platform
// its commission on that ride. One immutable row per completed cash/
// transfer ride; settlement is manual (driver transfers the commission to
// the company outside the app, an admin marks the relevant rows settled)
// since there's no payment gateway involved in this direction either.
const driverCommissionSchema = new mongoose.Schema(
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
      unique: true, // one row per ride, same guarantee as DriverEarning
    },

    grossAmount: {
      type: Number,
      required: true,
    },

    commissionRate: {
      type: Number,
      required: true,
    },

    // What the driver owes the platform for this ride.
    commissionAmount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "settled"],
      default: "pending",
    },

    settledAt: {
      type: Date,
      default: null,
    },

    // Admin User who marked this settled — for accountability on who
    // confirmed the driver actually paid.
    settledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

driverCommissionSchema.index({ driver: 1, status: 1 });

module.exports = mongoose.model("DriverCommission", driverCommissionSchema);
