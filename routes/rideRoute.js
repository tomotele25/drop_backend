const {
  bookRide,
  getAvailableRider,
  createRide,
  joinRide,
  getAvailableRooms,
  getRoomById,
  getRouteAndRides,
  getAutocompleteSuggestions,
} = require("../controller/rides");
const express = require("express");

const router = express.Router();

router.post("/bookRide", bookRide);

router.get("/availableRides", getAvailableRider);

router.post("/createRoom", createRide);

router.post("/joinRoom", joinRide);

router.post("/autocomplete", getAutocompleteSuggestions);

router.post("/route-and-rides", getRouteAndRides);

router.get("/availableRooms", getAvailableRooms);

router.get("/room/:id", getRoomById);
module.exports = router;
