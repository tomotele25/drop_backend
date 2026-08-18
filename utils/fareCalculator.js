// Rush-hour floor multiplier for the given local hour (0-23). Defaults to
// no surge for hours not listed. `surgeSchedule` keys may be numbers or
// strings (Mongoose Maps round-trip through JSON as string keys).
const getScheduleMultiplier = (hour, surgeSchedule) =>
  surgeSchedule[hour] ?? surgeSchedule[String(hour)] ?? 1.0;

// Live adjustment based on nearby available drivers vs pending requests in
// the pickup radius. First tier whose threshold the ratio meets applies.
const getSupplyMultiplier = (nearbyDriverCount, pendingRequestCount, surgeSupplyTiers) => {
  if (!pendingRequestCount) return 1.0;
  const ratio = nearbyDriverCount / pendingRequestCount;
  const tier = surgeSupplyTiers.find((t) => ratio <= t.maxDriversPerRequest);
  return tier ? tier.multiplier : 1.0;
};

// Pure fare calculation shared by the booking flow (bookRide) and the
// fare-estimate endpoint (getRouteAndRides) so both always agree on price
// for the same inputs at the same moment.
//
// `rates` is the live pricing config (utils/pricingConfig.js's
// getPricingConfig()) — passed in rather than imported here so this stays a
// pure, easily-testable function and every caller is guaranteed to be using
// whatever an admin currently has configured, not a stale hardcoded value.
//
// nearbyDriverCount/pendingRequestCount are passed in (rather than queried
// here) to keep this function pure and avoid a circular dependency with
// controller/rides.js, which owns the DB-querying dispatch helpers.
const calculateFare = ({
  rideType,
  distanceKm,
  durationMinutes,
  nearbyDriverCount = 0,
  pendingRequestCount = 0,
  now = new Date(),
  rates,
}) => {
  const normalizedType = rideType.toLowerCase();
  if (!(normalizedType in rates.baseFares)) {
    throw new Error(`Invalid ride type: ${rideType}`);
  }

  const rawFare =
    rates.baseFares[normalizedType] +
    distanceKm * rates.perKm +
    durationMinutes * rates.perMinute;

  const scheduleMultiplier = getScheduleMultiplier(now.getHours(), rates.surgeSchedule);
  const supplyMultiplier = getSupplyMultiplier(
    nearbyDriverCount,
    pendingRequestCount,
    rates.surgeSupplyTiers,
  );
  const surgeMultiplier = Math.min(
    scheduleMultiplier * supplyMultiplier,
    rates.maxSurgeMultiplier,
  );

  const basePrice = Math.ceil((rawFare * surgeMultiplier) / 50) * 50;

  return {
    basePrice,
    surgeMultiplier,
    breakdown: {
      rawFare,
      scheduleMultiplier,
      supplyMultiplier,
      reason: surgeMultiplier > 1 ? (scheduleMultiplier > 1 ? "rush hour" : "high demand") : null,
    },
  };
};

module.exports = { calculateFare };
