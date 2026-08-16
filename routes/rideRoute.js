const {
  bookRide,
  getAvailableRider,
  getRouteAndRides,
  getRideById,
  getRiderById,
  getAutocompleteSuggestions,
  getTotalRides,
  getCustomerRides,
  cancelRide,
  markArrivedAtPickup,
  markPickedUp,
  completeRide,
  rateRide,
  geocodeAddress,
  backfillDriverLocations,
  debugDriverLocations,
  runStuckActiveRideCleanup,
} = require("../controller/rides");
const {authenticateToken,ridersOnly} = require("../middleware/riders")
const { bookingLimiter } = require("../middleware/rateLimit");
const authorizeRole = require("../middleware/role");
const express = require("express");

const router = express.Router();

router.post("/bookRide", authenticateToken, bookingLimiter, bookRide);

router.get("/ride/:id", authenticateToken, getRideById);

router.get("/availableRides", getAvailableRider);

router.get("/rider/:id", getRiderById);


router.get("/rides/customer/:id", authenticateToken, getCustomerRides)

router.get("/rides/:id", authenticateToken, getTotalRides)

router.post("/ride/:id/cancel", authenticateToken, cancelRide);
router.post("/ride/:id/arrived", authenticateToken, markArrivedAtPickup);
router.post("/ride/:id/picked-up", authenticateToken, markPickedUp);
router.post("/ride/:id/complete", authenticateToken, completeRide);
router.post("/ride/:id/rate", authenticateToken, rateRide);

router.post("/autocomplete", bookingLimiter, getAutocompleteSuggestions);

router.post("/geocode", bookingLimiter, geocodeAddress);

router.post("/route-and-rides", bookingLimiter, getRouteAndRides);

router.post(
  "/admin/backfill-driver-locations",
  authenticateToken,
  authorizeRole("admin"),
  backfillDriverLocations,
);

router.get("/admin/debug-driver-locations", authenticateToken, debugDriverLocations);

// TEMPORARY: gated to any authenticated user (not admin-only) so it can be
// verified with a regular test account first, then locked to
// authorizeRole("admin") once confirmed.
router.post("/admin/cleanup-stuck-rides", authenticateToken, runStuckActiveRideCleanup);

module.exports = router;
