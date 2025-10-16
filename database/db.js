require("dotenv").config();
const mongoose = require("mongoose");

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

let retryCount = 0;

const connectToDb = async () => {
  const connect = async () => {
    try {
      await mongoose.connect(process.env.DB_URL, {
        serverSelectionTimeoutMS: 60000,
        socketTimeoutMS: 60000,
      });
      console.log("✅ MongoDB connected successfully");
    } catch (err) {
      console.error(
        `❌ MongoDB connection failed (attempt ${retryCount + 1}):`,
        err.message
      );

      retryCount += 1;
      if (retryCount < MAX_RETRIES) {
        console.log(`🔁 Retrying in ${RETRY_DELAY_MS / 1000} seconds...`);
        setTimeout(connect, RETRY_DELAY_MS);
      } else {
        console.error(
          "🚨 Max retry attempts reached. Could not connect to MongoDB."
        );
        process.exit(1);
      }
    }
  };

  connect();
};

module.exports = connectToDb;
