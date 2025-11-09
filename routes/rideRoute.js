const {
  bookRide,
  getAvailableRider,
  createRide,
  joinRide,
  getAvailableRooms,
  getRoomById,
} = require("../controller/rides");
const express = require("express");

const router = express.Router();

router.post("/bookRide", bookRide);

router.get("/availableRides", getAvailableRider);

router.post("/createRoom", createRide);

router.post("/joinRoom", joinRide);

router.get("/availableRooms", getAvailableRooms);

router.get("/room/:id", getRoomById);
module.exports = router;
