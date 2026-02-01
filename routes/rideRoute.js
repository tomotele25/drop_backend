const {
  bookRide,
  getAvailableRider,
  getRouteAndRides,
  getRideById,
  getRiderById,
  getAutocompleteSuggestions,
} = require("../controller/rides");
const express = require("express");

const router = express.Router();

router.post("/bookRide", bookRide);

router.get("/ride/:id", getRideById);

router.get("/availableRides", getAvailableRider);

router.get("/rider/:id", getRiderById);



router.post("/autocomplete", getAutocompleteSuggestions);

router.post("/route-and-rides", getRouteAndRides);

module.exports = router;
