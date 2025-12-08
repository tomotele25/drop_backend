const {
  bookRide,
  getAvailableRider,
  createRide,
  joinRide,
  getAvailableRooms,
  getRoomById,
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

router.post("/createRoom", createRide);

router.post("/joinRoom", joinRide);

router.post("/autocomplete", getAutocompleteSuggestions);

router.post("/route-and-rides", getRouteAndRides);

router.get("/availableRooms", getAvailableRooms);

router.get("/room/:id", getRoomById);
module.exports = router;
