const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema({
  seats: {
    type: Number,
    required: true,
  },
  location: {
    type: String,
    required: true,
  },
  destination: {
    type: String,
    required: true,
  },
  rideType: {
    type: String,
    enum: ["standard", "shared", "premium"],
    required: true,
  },
  driver: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  bookedAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Ride", rideSchema);
