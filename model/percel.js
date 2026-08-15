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
    // The frontend actually collects a delivery-speed tier ("standard",
    // "express", "sameDay"), not a yes/no flag — this used to be typed
    // Boolean, which meant every real submission with a speed selected
    // failed Mongoose validation (CastError) before it ever saved.
    express: {
      type: String,
      enum: ["standard", "express", "sameDay"],
      default: "standard",
    },
    assignedDriverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: false,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    image: {
      type: String,
      default: null,
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
