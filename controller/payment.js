const crypto = require("crypto");
const mongoose = require("mongoose");
const Transaction = require("../model/transaction");
const Wallet = require("../model/wallet");
const Ride = require("../model/ride");
const { verifyTransaction } = require("../utils/paystack");
const { dispatchRideToDrivers } = require("./rides");

// Paystack signs the raw request body with your secret key (HMAC SHA512) and
// sends it as x-paystack-signature. This is the only thing that proves a
// webhook call actually came from Paystack and wasn't spoofed by a client
// hitting this endpoint directly with a fake "charge.success" payload.
const verifySignature = (rawBody, signature) => {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha512", process.env.PAYSTACK_API_SECRET)
    .update(rawBody)
    .digest("hex");
  return hash === signature;
};

const paystackWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-paystack-signature"];
    const rawBody = req.body; // Buffer — this route is mounted with express.raw()

    if (!verifySignature(rawBody, signature)) {
      console.warn("⚠️ Paystack webhook signature mismatch — rejecting");
      return res.status(400).json({ success: false, message: "Invalid signature" });
    }

    const event = JSON.parse(rawBody.toString("utf8"));

    // Always 200 quickly once the payload is authenticated — Paystack retries
    // on non-2xx, and we don't want retries piling up while we process.
    res.status(200).json({ received: true });

    if (event.event !== "charge.success") return;

    const reference = event.data?.reference;
    if (!reference) return;

    const transaction = await Transaction.findOne({ reference });
    if (!transaction) {
      console.warn(`⚠️ Webhook for unknown reference: ${reference}`);
      return;
    }

    // Idempotency: a webhook can legitimately be delivered more than once
    // for the same event. If we've already settled this reference, stop here.
    if (transaction.status === "success") return;

    // Re-verify against Paystack's API rather than trusting the webhook body's
    // amount/status outright — belt-and-suspenders beyond the signature check.
    const verified = await verifyTransaction(reference);
    const verifiedData = verified.data;

    if (verifiedData.status !== "success") {
      transaction.status = "failed";
      transaction.gatewayResponse = verifiedData;
      await transaction.save();
      return;
    }

    const expectedKobo = Math.round(transaction.amount * 100);
    if (verifiedData.amount !== expectedKobo) {
      console.error(
        `❌ Amount mismatch on ${reference}: expected ${expectedKobo} kobo, got ${verifiedData.amount}`,
      );
      transaction.status = "failed";
      transaction.gatewayResponse = verifiedData;
      await transaction.save();
      return;
    }

    // Marking the transaction "success" and crediting the wallet / marking
    // the ride paid need to land together — previously these were two
    // separate writes, so a crash in between could mark a payment
    // successful without ever actually crediting anything.
    const session = await mongoose.startSession();
    let ride = null;
    try {
      await session.withTransaction(async () => {
        transaction.status = "success";
        transaction.gatewayResponse = verifiedData;
        await transaction.save({ session });

        if (transaction.type === "wallet_topup") {
          await Wallet.findOneAndUpdate(
            { user: transaction.user },
            { $inc: { balance: transaction.amount } },
            { upsert: true, session },
          );
        } else if (transaction.type === "order_payment" && transaction.orderType === "Ride") {
          ride = await Ride.findOneAndUpdate(
            { _id: transaction.orderId, paymentStatus: "unpaid" },
            { paymentStatus: "paid" },
            { new: true, session },
          );
        }
      });
    } finally {
      session.endSession();
    }

    if (transaction.type === "wallet_topup") {
      console.log(`✅ Wallet funded: user ${transaction.user}, +₦${transaction.amount}`);
      return;
    }

    // Dispatch is deliberately outside the transaction — same reasoning as
    // the wallet booking path: it's a real-time side effect, not something
    // that should roll back the payment confirmation itself.
    if (ride) {
      const { notifiedCount } = await dispatchRideToDrivers(ride);
      console.log(
        `✅ Ride ${ride._id} paid via Paystack, dispatched to ${notifiedCount} drivers`,
      );
    }
  } catch (error) {
    console.error("Paystack webhook error:", error?.response?.data || error.message);
    // Response has already been sent above; nothing more to send here.
  }
};

module.exports = { paystackWebhook };
