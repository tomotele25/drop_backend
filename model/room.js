// models/Room.js
const mongoose = require("mongoose");

const RoomSchema = new mongoose.Schema(
  {
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      default: null,
    },
    creatorName: {
      type: String,
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    pickupLocation: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    seats: {
      type: Number,
      required: true,
      min: 1,
    },
    passengers: [
      {
        passengerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        name: String,
      },
    ],
    rideType: {
      type: String,
      enum: ["standard", "premium", "shared"],
      default: "shared",
    },
    basePrice: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["available", "full", "completed"],
      default: "available",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Room", RoomSchema);
