// Centralized so the same rate is used when a DriverEarning ledger row is
// created and anywhere else that needs to reason about driver payout math.
const PLATFORM_COMMISSION_RATE = 0.2; // 20% platform commission, 80% to driver

// A payout that keeps failing (bad account, closed bank, etc.) shouldn't
// retry silently forever — after this many failed batch attempts it's
// marked terminally "failed" and needs manual intervention.
const MAX_PAYOUT_ATTEMPTS = 5;

module.exports = { PLATFORM_COMMISSION_RATE, MAX_PAYOUT_ATTEMPTS };
