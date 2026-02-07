require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const connectToDb = require("../database/db");

// Routes
const authRoute = require("../routes/authRoute");
const rideRoute = require("../routes/rideRoute");
const riderRoute = require("../routes/riderRoute");

// Models
const Ride = require("../model/ride");
const Rider = require("../model/rider");

const app = express();
const PORT = process.env.PORT || 8001;

// ================= ALLOWED ORIGINS =================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://drop-red.vercel.app",
  "https://drop-driver.vercel.app",
];

// ================= EXPRESS CORS =================
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

// ================= MIDDLEWARE =================
app.use(express.json());

// ================= ROUTES =================
app.get("/", (_, res) => res.send("🚀 Server is running"));
app.use("/api", authRoute);
app.use("/api", rideRoute);
app.use("/api", riderRoute);

// ================= HTTP SERVER =================
const server = http.createServer(app);

// ================= SOCKET.IO =================
const io = new Server(server, {
  transports: ["polling", "websocket"], // IMPORTANT for Render/Vercel
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ================= GLOBAL SOCKET MAPS =================
const driverSockets = new Map(); // driverId -> socketId
const riderSockets = new Map(); // riderId -> socketId
const socketDrivers = new Map(); // socketId -> driverId
const socketRiders = new Map(); // socketId -> riderId

global.io = io;
global.driverSockets = driverSockets;
global.riderSockets = riderSockets;

// ================= SOCKET CONNECTION =================
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  // ---------- REGISTER DRIVER ----------
  socket.on("registerDriver", async ({ driverId }) => {
    if (!driverId) return;

    const dId = driverId.toString();
    driverSockets.set(dId, socket.id);
    socketDrivers.set(socket.id, dId);

    console.log(`🚗 Driver registered: ${dId}`);

    // Send pending rides
    try {
      const pendingRides = await Ride.find({
        driver: dId,
        status: "requested",
      });

      pendingRides.forEach((ride) => {
        io.to(socket.id).emit("rideAssigned", {
          rideId: ride._id.toString(),
          pickup: ride.pickup,
          destination: ride.destination,
          passengerName: ride.passengerName,
          fare: ride.fare,
          distance: ride.distance,
          duration: ride.duration,
        });
      });
    } catch (err) {
      console.error("❌ Pending ride error:", err.message);
    }
  });

  // ---------- REGISTER RIDER ----------
  socket.on("registerRider", ({ riderId }) => {
    if (!riderId) return;

    const rId = riderId.toString();
    riderSockets.set(rId, socket.id);
    socketRiders.set(socket.id, rId);

    console.log(`🧍 Rider registered: ${rId}`);
  });

  // ---------- DRIVER LOCATION UPDATE ----------
  socket.on("driverLocation", async ({ driverId, lat, lng }) => {
    if (!driverId || lat == null || lng == null) return;

    try {
      await Rider.findByIdAndUpdate(driverId, {
        currentLocation: { latitude: lat, longitude: lng },
      });

      socket.broadcast.emit("locationUpdate", { driverId, lat, lng });
    } catch (err) {
      console.error("❌ Location update error:", err.message);
    }
  });

  // ---------- ACCEPT RIDE ----------
  socket.on("acceptRide", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "requested" },
        { status: "assigned", driver: driverId },
        { new: true },
      );

      if (!ride) {
        socket.emit("rideTaken");
        return;
      }

      console.log(`✅ Ride ${rideId} accepted by driver ${driverId}`);

      const riderSocketId = riderSockets.get(ride.passengerId?.toString());

      if (riderSocketId) {
        io.to(riderSocketId).emit("rideAccepted", {
          rideId: ride._id.toString(),
          driverId,
        });
      }

      socket.emit("rideAccepted", { ride });
    } catch (err) {
      console.error("❌ Accept ride error:", err.message);
    }
  });

  
  // ---------- DRIVER ARRIVED AT PICKUP ----------
  socket.on("arrivedAtPickup", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "assigned", driver: driverId },
        { status: "ongoing" },
        { new: true },
      );

      if (!ride)
        return socket.emit("invalidAction", {
          message: "Ride not in assigned status",
        });

      console.log(`🚦 Driver ${driverId} arrived at pickup for ride ${rideId}`);

      // Notify rider
      const riderSocketId = riderSockets.get(ride.passengerId?.toString());
      if (riderSocketId) {
        io.to(riderSocketId).emit("rideOngoing", {
          rideId: ride._id.toString(),
          driverId,
        });
      }

      // Confirm to driver
      socket.emit("pickupConfirmed", { ride });
    } catch (err) {
      console.error("❌ Arrived at pickup error:", err.message);
    }
  });

  // ---------- END TRIP ----------
  socket.on("endTrip", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "ongoing", driver: driverId },
        { status: "completed" },
        { new: true },
      );

      if (!ride)
        return socket.emit("invalidAction", { message: "Ride not ongoing" });

      console.log(`🏁 Ride ${rideId} completed by driver ${driverId}`);

      const riderSocketId = riderSockets.get(ride.passengerId?.toString());
      if (riderSocketId) {
        io.to(riderSocketId).emit("rideCompleted", {
          rideId: ride._id.toString(),
          driverId,
        });
      }

      socket.emit("tripEnded", { ride });
    } catch (err) {
      console.error("❌ End trip error:", err.message);
    }
  });

  // ---------- REJECT RIDE ----------
  socket.on("rejectRide", ({ rideId, driverId }) => {
    console.log(`❌ Driver ${driverId} rejected ride ${rideId}`);
    socket.emit("rideRejected", { rideId });
  });

  // ---------- DISCONNECT ----------
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);

    const driverId = socketDrivers.get(socket.id);
    if (driverId) {
      driverSockets.delete(driverId);
      socketDrivers.delete(socket.id);
      console.log(`🚗 Driver removed: ${driverId}`);
    }

    const riderId = socketRiders.get(socket.id);
    if (riderId) {
      riderSockets.delete(riderId);
      socketRiders.delete(socket.id);
      console.log(`🧍 Rider removed: ${riderId}`);
    }
  });
});

// ================= START SERVER =================
const startServer = async () => {
  try {
    await connectToDb();
    console.log("✅ MongoDB connected");

    server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  }
};

startServer();

module.exports = app;
