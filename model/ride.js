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
    default: "standard",
  },

  totalSeats: {
    type: Number,
    default: 6,
  },
  availableSeats: {
    type: Number,
    default: 4,
  },

  passengerName: {
    type: String,
    required: function () {
      return this.rideType !== "shared";
    },
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
    required: false,
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
