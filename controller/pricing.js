const PricingConfig = require("../model/pricingConfig");
const { getPricingConfig, invalidatePricingCache, toPlainRates } = require("../utils/pricingConfig");

// GET /api/admin/pricing — current live fare-calculation config, seeding
// it from the hardcoded defaults on first-ever call so there's always
// something real to show/edit.
const getPricing = async (req, res) => {
  try {
    const pricing = await getPricingConfig();
    return res.status(200).json({ success: true, pricing });
  } catch (error) {
    console.error("Get pricing error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const RIDE_TYPES = ["standard", "premium"];

// PATCH /api/admin/pricing — admin-only. Validates the shape/sanity of
// every field before saving, since a bad value here (e.g. a negative
// per-km rate, or commission > 100%) would silently break every fare
// calculated afterward.
const updatePricing = async (req, res) => {
  try {
    const {
      baseFares,
      perKm,
      perMinute,
      minDriverNetPayout,
      platformCommissionRate,
      surgeSchedule,
      surgeSupplyTiers,
      maxSurgeMultiplier,
    } = req.body || {};

    const errors = [];

    if (
      !baseFares ||
      typeof baseFares !== "object" ||
      RIDE_TYPES.some((t) => typeof baseFares[t] !== "number" || baseFares[t] < 0)
    ) {
      errors.push("baseFares must include a non-negative number for each of: " + RIDE_TYPES.join(", "));
    }
    if (typeof perKm !== "number" || perKm < 0) errors.push("perKm must be a non-negative number");
    if (typeof perMinute !== "number" || perMinute < 0) errors.push("perMinute must be a non-negative number");
    if (typeof minDriverNetPayout !== "number" || minDriverNetPayout < 0) {
      errors.push("minDriverNetPayout must be a non-negative number");
    }
    if (
      typeof platformCommissionRate !== "number" ||
      platformCommissionRate < 0 ||
      platformCommissionRate > 1
    ) {
      errors.push("platformCommissionRate must be a number between 0 and 1");
    }
    if (typeof maxSurgeMultiplier !== "number" || maxSurgeMultiplier < 1) {
      errors.push("maxSurgeMultiplier must be a number >= 1");
    }
    if (
      surgeSchedule &&
      (typeof surgeSchedule !== "object" ||
        Object.entries(surgeSchedule).some(
          ([hour, mult]) =>
            Number.isNaN(Number(hour)) ||
            Number(hour) < 0 ||
            Number(hour) > 23 ||
            typeof mult !== "number" ||
            mult < 0,
        ))
    ) {
      errors.push("surgeSchedule must map hour (0-23) to a non-negative multiplier");
    }
    if (
      surgeSupplyTiers &&
      (!Array.isArray(surgeSupplyTiers) ||
        surgeSupplyTiers.some(
          (t) =>
            typeof t.maxDriversPerRequest !== "number" ||
            typeof t.multiplier !== "number" ||
            t.multiplier < 0,
        ))
    ) {
      errors.push("surgeSupplyTiers must be an array of { maxDriversPerRequest, multiplier }");
    }

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join("; ") });
    }

    let doc = await PricingConfig.findOne();
    if (!doc) doc = new PricingConfig();

    doc.baseFares = baseFares;
    doc.perKm = perKm;
    doc.perMinute = perMinute;
    doc.minDriverNetPayout = minDriverNetPayout;
    doc.platformCommissionRate = platformCommissionRate;
    if (surgeSchedule) doc.surgeSchedule = surgeSchedule;
    if (surgeSupplyTiers) doc.surgeSupplyTiers = surgeSupplyTiers;
    doc.maxSurgeMultiplier = maxSurgeMultiplier;
    doc.updatedBy = req.user.id;

    await doc.save();
    invalidatePricingCache();

    return res.status(200).json({ success: true, pricing: toPlainRates(doc) });
  } catch (error) {
    console.error("Update pricing error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getPricing, updatePricing };
