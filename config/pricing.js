// These are now only the SEED defaults for the first-ever PricingConfig
// document (see model/pricingConfig.js + utils/pricingConfig.js) and the
// emergency fallback if that DB read ever fails — the live values admins
// actually edit from the dashboard. Rebalanced from the original hardcoded
// numbers so a driver's per-trip take is meaningfully healthier (especially
// on short trips, where the payout floor was the thin part), while the
// per-km/per-minute bump is modest enough that riders are paying for
// comfort/reliability, not getting gouged.
const BASE_FARES = { standard: 500, premium: 1000 };
const PER_KM = 165; // was 149
const PER_MINUTE = 26; // was 22

// A driver should never net less than this per completed ride, even on a
// very short/cheap trip where 20% commission would otherwise leave them
// with almost nothing. Raised from 400 — on a short trip that's barely
// worth a driver's fuel and time once you account for the drive back to
// pick up the next rider.
const MIN_DRIVER_NET_PAYOUT = 550; // was 400

// Rush-hour floor multiplier, keyed by local hour (0-23). Hours not listed
// default to 1.0 (no surge).
const SURGE_SCHEDULE = {
  7: 1.2,
  8: 1.2,
  9: 1.2,
  16: 1.2,
  17: 1.2,
  18: 1.2,
  19: 1.2,
};

// Live adjustment on top of the schedule floor, based on nearby available
// drivers per pending request in the pickup radius. Checked in order —
// first tier whose threshold the ratio meets applies.
const SURGE_SUPPLY_TIERS = [
  { maxDriversPerRequest: 0.5, multiplier: 1.5 },
  { maxDriversPerRequest: 1, multiplier: 1.2 },
  { maxDriversPerRequest: Infinity, multiplier: 1.0 },
];

// Hard cap on the combined (schedule * live) multiplier.
const MAX_SURGE_MULTIPLIER = 2.0;

// How far back to look for competing pending requests near the same pickup
// when estimating live demand. Not admin-editable — an implementation
// detail of the demand signal, not a fairness lever.
const RECENT_REQUEST_WINDOW_MINUTES = 10;

module.exports = {
  BASE_FARES,
  PER_KM,
  PER_MINUTE,
  MIN_DRIVER_NET_PAYOUT,
  SURGE_SCHEDULE,
  SURGE_SUPPLY_TIERS,
  MAX_SURGE_MULTIPLIER,
  RECENT_REQUEST_WINDOW_MINUTES,
};
