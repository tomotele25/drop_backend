const { getAvailableRides, bookRide } = require("../controller/rides");
const express = require("express");

const router = express.Router();

router.post("/bookRides", bookRide);
router.get("/availableRides", getAvailableRides);

module.exports = router;
