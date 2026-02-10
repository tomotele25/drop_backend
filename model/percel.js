const mongoose = require("mongoose");

const PercelSchema = new mongoose.Schema(
  {
    pickupCoordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    destinationCoordinates: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
    },
    pickup: {
      type: String,
      required: true,
    },
    destination: {
      type: String,
      required: true,
    },
    senderPhone: {
      type: String,
      required: true,
    },
    receiverPhone: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: false,
    },
    paymentBy: {
      type: String,
      enum: ["receiver", "sender"], 
      required: true,
    },
    express: {
      type: Boolean,
      default: false,
    },
    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
      required: false,
    },
    status: {
      type: String,
      enum: ["Pending", "In Transit", "Delivered", "Cancelled"],
      default: "Pending",
    },
  },
  { timestamps: true }, 
);

module.exports = mongoose.model("Percel", PercelSchema);
