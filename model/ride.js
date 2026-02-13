const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
    // Driver - will be null until a driver accepts
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      default: null,
    },

    // Pickup location
    pickup: {
      type: String,
      required: true,
    },

    // Destination location
    destination: {
      type: String,
      required: true,
    },

    // Coordinates
    pickupCoordinates: {
      lat: Number,
      lng: Number,
    },

    destinationCoordinates: {
      lat: Number,
      lng: Number,
    },

    // Trip details
    distance: {
      type: Number,
      required: true,
    },

    duration: {
      type: Number,
      required: true,
    },

    // Ride type
    rideType: {
      type: String,
      enum: ["Standard", "Premium", "Comfort"],
      default: "standard",
    },

    // Base price
    basePrice: {
      type: Number,
      required: true,
    },

    // Passengers
    passengers: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        name: String,
        phone: String,
      },
    ],

    // Status
    status: {
      type: String,
      enum: [
        "pending",
        "requested",
        "accepted",
        "arrived",
        "ongoing",
        "completed",
        "cancelled",
        "no_drivers_available",
      ],
      default: "pending",
    },

    // Timestamps
    requestedAt: {
      type: Date,
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    arrivedAt: {
      type: Date,
      default: null,
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    // Rejected by drivers
    rejectedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Rider",
      },
    ],

    // Rating
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },

    // Review
    review: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// ✅ NO PRE-SAVE HOOKS - Driver will only be assigned when driver accepts

// Index for finding active rides
rideSchema.index({ driver: 1, status: 1 });
rideSchema.index({ "passengers.userId": 1, status: 1 });

module.exports = mongoose.model("Ride", rideSchema);
