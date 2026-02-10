const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema({
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rider",
    required: false,
  },
  pickup: {
    type: String,
    required: true,
    trim: true,
  },
  destination: {
    type: String,
    required: true,
    trim: true,
  },
  distance: {
    type: Number,
    required: true,
  },
  duration: {
    type: Number, 
    required: true,
  },

  pickupCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  },
  destinationCoordinates: {
    lat: { type: Number },
    lng: { type: Number },
  },

  rideType: {
    type: String,
    enum: ["Standard", "Premium", "Shared"],
    default: "Standard",
  },

  totalSeats: {
    type: Number,
    default: 6,
  },
  availableSeats: {
    type: Number,
    default: 4,
  },
  passengers: [
    {
      name: {
        type: String,
        required: true,
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
  ],

  basePrice: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ["requested", "assigned", "ongoing", "completed", "cancelled"],
    default: "requested",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("Ride", rideSchema);
