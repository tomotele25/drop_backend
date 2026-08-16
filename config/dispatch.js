// How long a ride can sit "pending" with no driver acceptance before it's
// auto-expired to "no_drivers_available" — previously there was no timeout
// at all, so an unaccepted ride sat forever with no customer-visible signal.
const RIDE_OFFER_TIMEOUT_MS = 90 * 1000; // 90 seconds

// How long a ride can sit "accepted"/"arrived"/"ongoing" — i.e. already
// matched to a driver — before it's treated as abandoned and auto-cancelled.
// Without this, an abandoned trip (driver's app closed, network dropped,
// a test booking nobody completed) permanently excludes that driver from
// findAvailableNearbyDrivers's busyDriverIds check, sidelining a real
// online driver forever over one dead ride. 3 hours comfortably covers any
// legitimate trip duration.
const STUCK_ACTIVE_RIDE_TIMEOUT_MS = 3 * 60 * 60 * 1000; // 3 hours

module.exports = { RIDE_OFFER_TIMEOUT_MS, STUCK_ACTIVE_RIDE_TIMEOUT_MS };
