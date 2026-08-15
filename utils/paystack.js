const axios = require("axios");

const PAYSTACK_BASE = "https://api.paystack.co";

const paystackClient = axios.create({
  baseURL: PAYSTACK_BASE,
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_API_SECRET}`,
    "Content-Type": "application/json",
  },
});

// Amount is passed in Naira; Paystack expects kobo (x100).
const initializeTransaction = async ({ email, amountNaira, reference, metadata, callback_url }) => {
  const res = await paystackClient.post("/transaction/initialize", {
    email,
    amount: Math.round(amountNaira * 100),
    reference,
    metadata,
    callback_url,
  });
  return res.data; // { status, message, data: { authorization_url, access_code, reference } }
};

const verifyTransaction = async (reference) => {
  const res = await paystackClient.get(`/transaction/verify/${encodeURIComponent(reference)}`);
  return res.data; // { status, message, data: { status: 'success'|..., amount, reference, ... } }
};

// Resolves an account number against a bank to get the account holder's
// name — used to confirm a driver actually owns the account before we ever
// attach it as a payout destination.
const resolveAccountNumber = async ({ accountNumber, bankCode }) => {
  const res = await paystackClient.get("/bank/resolve", {
    params: { account_number: accountNumber, bank_code: bankCode },
  });
  return res.data; // { status, data: { account_number, account_name } }
};

const listBanks = async () => {
  const res = await paystackClient.get("/bank", { params: { country: "nigeria" } });
  return res.data; // { status, data: [{ name, code, ... }] }
};

// Must be called once per driver before any transfer can be sent to them.
const createTransferRecipient = async ({ name, accountNumber, bankCode }) => {
  const res = await paystackClient.post("/transferrecipient", {
    type: "nuban",
    name,
    account_number: accountNumber,
    bank_code: bankCode,
    currency: "NGN",
  });
  return res.data; // { status, data: { recipient_code, ... } }
};

// Amount is passed in Naira; Paystack expects kobo (x100).
const initiateTransfer = async ({ amountNaira, recipientCode, reference, reason }) => {
  const res = await paystackClient.post("/transfer", {
    source: "balance",
    amount: Math.round(amountNaira * 100),
    recipient: recipientCode,
    reference,
    reason,
  });
  return res.data; // { status, data: { status: 'success'|'pending'|'otp', ... } }
};

module.exports = {
  initializeTransaction,
  verifyTransaction,
  resolveAccountNumber,
  listBanks,
  createTransferRecipient,
  initiateTransfer,
};
