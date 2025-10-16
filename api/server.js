const express = require("express");
const cors = require("cors");
const PORT = 8001;
const app = express();
const connectToDb = require("../database/db");
const authRoute = require("../routes/authRoute");
const rideRoute = require("../routes/rideRoute");
const riderRoute = require("../routes/riderRoute");
const allowedOrigins = ["http://localhost:3000"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  console.log("test route hit");
  res.send("Hello world");
});

// Connect to DB and set routes
const startServer = async () => {
  try {
    await connectToDb();
    console.log("Database connected");

    app.use("/api", authRoute);
    app.use("/api", rideRoute);
    app.use("/api", riderRoute);
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

startServer();

module.exports = app;
