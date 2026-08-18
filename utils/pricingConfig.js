const PricingConfig = require("../model/pricingConfig");
const DEFAULTS = require("../config/pricing");
const { PLATFORM_COMMISSION_RATE } = require("../config/earnings");

// calculateFare() runs on every booking AND every fare estimate — hitting
// the DB on every single call would be wasteful for values that change
// maybe once a month. Cached in memory, short TTL so an admin's edit takes
// effect quickly without needing a restart.
let cache = null;
let cacheAt = 0;
const TTL_MS = 60_000;

function toPlainRates(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  return {
    _id: obj._id,
    baseFares: obj.baseFares,
    perKm: obj.perKm,
    perMinute: obj.perMinute,
    minDriverNetPayout: obj.minDriverNetPayout,
    platformCommissionRate: obj.platformCommissionRate,
    // Mongoose Maps serialize to plain objects via toObject() by default,
    // but guard in case a raw Map ever reaches here.
    surgeSchedule: obj.surgeSchedule instanceof Map
      ? Object.fromEntries(obj.surgeSchedule)
      : obj.surgeSchedule ?? {},
    surgeSupplyTiers: obj.surgeSupplyTiers,
    maxSurgeMultiplier: obj.maxSurgeMultiplier,
    updatedAt: obj.updatedAt,
  };
}

const FALLBACK_RATES = {
  baseFares: DEFAULTS.BASE_FARES,
  perKm: DEFAULTS.PER_KM,
  perMinute: DEFAULTS.PER_MINUTE,
  minDriverNetPayout: DEFAULTS.MIN_DRIVER_NET_PAYOUT,
  platformCommissionRate: PLATFORM_COMMISSION_RATE,
  surgeSchedule: DEFAULTS.SURGE_SCHEDULE,
  surgeSupplyTiers: DEFAULTS.SURGE_SUPPLY_TIERS,
  maxSurgeMultiplier: DEFAULTS.MAX_SURGE_MULTIPLIER,
};

// Reads the live pricing config, seeding it from the hardcoded defaults the
// very first time this is ever called (so there's nothing to manually
// migrate — the admin dashboard's first load already has real values to
// show and edit). Falls back to those same defaults, un-cached, if the DB
// read itself fails — fare calculation should degrade, never hard-crash.
async function getPricingConfig() {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;

  try {
    let doc = await PricingConfig.findOne();
    if (!doc) {
      doc = await PricingConfig.create(FALLBACK_RATES);
    }
    cache = toPlainRates(doc);
    cacheAt = now;
    return cache;
  } catch (err) {
    console.error("Failed to load pricing config, using hardcoded fallback:", err.message);
    return FALLBACK_RATES;
  }
}

// Called after an admin write so the next fare calculation picks up the
// change immediately instead of waiting out the TTL.
function invalidatePricingCache() {
  cache = null;
}

module.exports = { getPricingConfig, invalidatePricingCache, toPlainRates };
