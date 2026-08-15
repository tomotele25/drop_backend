const Wallet = require("../model/wallet");
const Transaction = require("../model/transaction");
const User = require("../model/user");
const { initializeTransaction } = require("../utils/paystack");

const getWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ user: req.user.id });
    return res.status(200).json({
      success: true,
      balance: wallet?.balance || 0,
    });
  } catch (error) {
    console.error("Get wallet error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Starts a Paystack checkout to top up the wallet. The balance is only
// credited once the webhook confirms the charge — never here.
const initializeWalletFunding = async (req, res) => {
  try {
    const { amount } = req.body || {};
    const amountNaira = Number(amount);

    if (!amountNaira || amountNaira <= 0) {
      return res.status(400).json({ success: false, message: "Invalid amount" });
    }

    const user = await User.findById(req.user.id).select("email");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const reference = `WALLET-${req.user.id}-${Date.now()}`;

    await Transaction.create({
      user: req.user.id,
      type: "wallet_topup",
      method: "paystack",
      reference,
      amount: amountNaira,
      status: "pending",
    });

    const paystackRes = await initializeTransaction({
      email: user.email,
      amountNaira,
      reference,
      metadata: { userId: req.user.id, type: "wallet_topup" },
      callback_url: process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/wallet`
        : undefined,
    });

    return res.status(200).json({
      success: true,
      payment: {
        authorization_url: paystackRes.data.authorization_url,
        reference,
      },
    });
  } catch (error) {
    console.error("Wallet funding init error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Could not start wallet funding" });
  }
};

const getTransactionHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(100);
    return res.status(200).json({ success: true, transactions });
  } catch (error) {
    console.error("Get transaction history error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { getWallet, initializeWalletFunding, getTransactionHistory };
