const {
  bookRide,
  getAvailableRider,
  getRouteAndRides,
  getRideById,
  getRiderById,
  getAutocompleteSuggestions,
  getTotalRides
} = require("../controller/rides");
const {authenticateToken,ridersOnly} = require("../middleware/riders")
const express = require("express");

const router = express.Router();

router.post("/bookRide", bookRide);

router.get("/ride/:id", getRideById);

router.get("/availableRides", getAvailableRider);

router.get("/rider/:id", getRiderById);


router.get("/rides/:id",getTotalRides)

router.post("/autocomplete", getAutocompleteSuggestions);

router.post("/route-and-rides", getRouteAndRides);

module.exports = router;
