// How long a ride can sit "pending" with no driver acceptance before it's
// auto-expired to "no_drivers_available" — previously there was no timeout
// at all, so an unaccepted ride sat forever with no customer-visible signal.
const RIDE_OFFER_TIMEOUT_MS = 90 * 1000; // 90 seconds

module.exports = { RIDE_OFFER_TIMEOUT_MS };
