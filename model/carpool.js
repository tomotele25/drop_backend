/**
 * CARPOOL ROOM MODEL
 * File: model/carpool.js
 */
const mongoose = require("mongoose");

// ================= PASSENGER SCHEMA =================
const passengerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    phone: String,
    checked: {
      type: Boolean,
      default: false,
    },
    checkedInTime: Date,
  },
  { _id: false },
);

// ================= CARPOOL ROOM SCHEMA =================
const carpoolRoomSchema = new mongoose.Schema(
  {
    // Route Info
    route: {
      type: String,
      required: true,
      index: true,
    },
    pickup: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    pickupCoordinates: {
      latitude: Number,
      longitude: Number,
    },
    destinationCoordinates: {
      latitude: Number,
      longitude: Number,
    },

    // Pricing & Type
    price: {
      type: Number,
      required: true,
    },
    rideType: {
      type: String,
      enum: ["Standard", "Comfort", "Premium"],
      default: "Standard",
    },

    // Room Config
    maxPassengers: {
      type: Number,
      default: 5,
    },
    status: {
      type: String,
      enum: ["waiting", "assigned", "in_progress", "completed", "cancelled"],
      default: "waiting",
      index: true,
    },

    // Driver Info
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
    },
    driverName: String,
    carModel: String,
    carColor: String,
    plateNo: String,

    // Passengers
    passengers: [passengerSchema],

    // Timing
    departureTime: {
      type: Date,
      required: true,
      index: true,
    },
    startedAt: Date,
    completedAt: Date,

    // Metadata
    distance: Number,
    duration: Number,
    requestedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

// ================= INDEXES =================
carpoolRoomSchema.index({ route: 1, status: 1 });
carpoolRoomSchema.index({ driverId: 1, status: 1 });
carpoolRoomSchema.index({ departureTime: 1, status: 1 });
carpoolRoomSchema.index({ "passengers.userId": 1 });

// ================= METHODS =================

/**
 * Check if room is full
 */
carpoolRoomSchema.methods.isFull = function () {
  return this.passengers.length >= this.maxPassengers;
};

/**
 * Get checked in count
 */
carpoolRoomSchema.methods.getCheckedInCount = function () {
  return this.passengers.filter((p) => p.checked).length;
};

/**
 * Add passenger
 */
carpoolRoomSchema.methods.addPassenger = async function (userId, name, phone) {
  if (this.isFull()) {
    throw new Error("Room is full");
  }

  if (this.passengers.some((p) => p.userId.toString() === userId.toString())) {
    throw new Error("User already in this room");
  }

  this.passengers.push({ userId, name, phone, checked: false });
  await this.save();
};

/**
 * Remove passenger
 */
carpoolRoomSchema.methods.removePassenger = async function (userId) {
  this.passengers = this.passengers.filter(
    (p) => p.userId.toString() !== userId.toString(),
  );
  await this.save();
};

/**
 * Check in passenger
 */
carpoolRoomSchema.methods.checkInPassenger = async function (userId) {
  const passenger = this.passengers.find(
    (p) => p.userId.toString() === userId.toString(),
  );

  if (!passenger) {
    throw new Error("User not in this room");
  }

  passenger.checked = true;
  passenger.checkedInTime = new Date();
  await this.save();
};

/**
 * Start ride - removes no-shows
 */
carpoolRoomSchema.methods.startRide = async function () {
  const notCheckedIn = this.passengers.filter((p) => !p.checked);
  this.passengers = this.passengers.filter((p) => p.checked);
  this.status = "in_progress";
  this.startedAt = new Date();
  await this.save();
  return notCheckedIn;
};

/**
 * Complete ride
 */
carpoolRoomSchema.methods.completeRide = async function () {
  this.status = "completed";
  this.completedAt = new Date();
  await this.save();
};

// ================= MODEL =================
const CarpoolRoom =
  mongoose.models.CarpoolRoom ||
  mongoose.model("CarpoolRoom", carpoolRoomSchema);

module.exports = CarpoolRoom;
