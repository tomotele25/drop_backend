const mongoose = require("mongoose");

// Singleton document (there should only ever be one row) holding every
// fare-calculation knob that used to be hardcoded in config/pricing.js and
// config/earnings.js. Editable from the admin dashboard instead of requiring
// a code change + redeploy every time fares need adjusting.
const pricingConfigSchema = new mongoose.Schema(
  {
    baseFares: {
      standard: { type: Number, required: true },
      premium: { type: Number, required: true },
    },
    perKm: { type: Number, required: true },
    perMinute: { type: Number, required: true },

    // A driver should never net less than this per completed ride, even on
    // a very short/cheap trip where commission would otherwise leave them
    // with almost nothing.
    minDriverNetPayout: { type: Number, required: true },

    // 0-1, e.g. 0.2 = platform keeps 20%, driver keeps 80%.
    platformCommissionRate: { type: Number, required: true, min: 0, max: 1 },

    // Rush-hour floor multiplier, keyed by local hour ("0"-"23") as a Map
    // since Mongoose requires string keys — hours not present default to
    // 1.0 (no surge) wherever this is read.
    surgeSchedule: { type: Map, of: Number, default: {} },

    // Live adjustment on top of the schedule floor, based on nearby
    // available drivers per pending request. Checked in order — first tier
    // whose threshold the ratio meets applies.
    surgeSupplyTiers: [
      {
        maxDriversPerRequest: { type: Number, required: true },
        multiplier: { type: Number, required: true },
        _id: false,
      },
    ],

    // Hard cap on the combined (schedule * live) multiplier.
    maxSurgeMultiplier: { type: Number, required: true },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("PricingConfig", pricingConfigSchema);
