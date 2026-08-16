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
} = require("../controller/rides");
const {authenticateToken,ridersOnly} = require("../middleware/riders")
const { bookingLimiter } = require("../middleware/rateLimit");
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

module.exports = router;
