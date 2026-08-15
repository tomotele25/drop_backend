const mongoose = require("mongoose");

// The financial ledger. One immutable row per money movement — never edit a
// row after creation, only insert new ones (e.g. a refund is its own row,
// not a mutation of the original payment). This is what "why was this
// customer charged twice?" / "where did this transaction go?" gets answered from.
const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: ["wallet_topup", "order_payment", "refund"],
      required: true,
    },

    method: {
      type: String,
      enum: ["paystack", "wallet"],
      required: true,
    },

    // Paystack transactions use the Paystack reference so the webhook can be
    // matched idempotently. Wallet-funded payments generate their own
    // internal reference since there's no external gateway call to key off.
    reference: {
      type: String,
      required: true,
      unique: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
    },

    // What this payment was for, if it was for an order rather than a wallet top-up.
    orderType: {
      type: String,
      enum: ["Ride", "CarpoolRoom", "Percel", null],
      default: null,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },

    // Raw gateway payload for the event that settled this transaction —
    // kept for reconciliation/dispute investigation.
    gatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true },
);

transactionSchema.index({ user: 1, createdAt: -1 });
transactionSchema.index({ orderType: 1, orderId: 1 });

module.exports = mongoose.model("Transaction", transactionSchema);
