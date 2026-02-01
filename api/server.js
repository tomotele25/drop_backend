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

const PORT = 8001;
const app = express();

// ================= CORS =================
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://drop-red.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
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

// ================= SOCKET.IO =================
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ================= GLOBAL SOCKET MAPS =================
const driverSockets = new Map(); // driverId -> socketId
const riderSockets = new Map(); // riderId -> socketId

global.io = io;
global.driverSockets = driverSockets;
global.riderSockets = riderSockets;

// ================= SOCKET CONNECTION =================
io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  // ----- REGISTER DRIVER -----
socket.on("registerDriver", async ({ driverId }) => {
  if (!driverId) return;

  // Save driver socket
  driverSockets.set(driverId.toString(), socket.id);
  console.log(`🚗 Driver registered: ${driverId} -> socket ${socket.id}`);

  // Send all pending rides
  try {
    const pendingRides = await Ride.find({
      driver: driverId,
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
      console.log(`🔔 Pending ride sent to driver ${driverId}`);
    });
  } catch (err) {
    console.error("❌ Error sending pending rides:", err.message);
  }
});


  // ----- REGISTER RIDER -----
  socket.on("registerRider", ({ riderId }) => {
    if (!riderId) return;
    riderSockets.set(riderId.toString(), socket.id);
    console.log(`🧍 Rider registered: ${riderId} -> socket ${socket.id}`);
  });

  // ----- DRIVER LOCATION UPDATE -----
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

  // ----- DRIVER ACCEPTS RIDE -----
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

      // Notify rider if online
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

  // ----- DRIVER REJECTS RIDE -----
  socket.on("rejectRide", ({ rideId, driverId }) => {
    console.log(`❌ Driver ${driverId} rejected ride ${rideId}`);
    socket.emit("rideRejected", { rideId });
  });

  // ----- DISCONNECT -----
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);

    // Remove from driverSockets
    for (const [id, sId] of driverSockets) {
      if (sId === socket.id) {
        driverSockets.delete(id);
        console.log(`🚗 Driver removed: ${id}`);
        break;
      }
    }

    // Remove from riderSockets
    for (const [id, sId] of riderSockets) {
      if (sId === socket.id) {
        riderSockets.delete(id);
        console.log(`🧍 Rider removed: ${id}`);
        break;
      }
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
