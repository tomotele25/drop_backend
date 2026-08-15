const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    // Stored in Naira as an integer (no kobo/decimals) to sidestep float
    // rounding — matches the rest of the codebase's Number-based money fields.
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Wallet", walletSchema);
