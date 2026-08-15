const rateLimit = require("express-rate-limit");

// Auth endpoints: brute-force protection on login/signup.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Try again later." },
});

// Booking/payment-triggering endpoints: each hit costs real money (Google
// Maps API calls, Paystack transaction inits) — cap request volume per IP.
const bookingLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests. Slow down." },
});

module.exports = { authLimiter, bookingLimiter };
