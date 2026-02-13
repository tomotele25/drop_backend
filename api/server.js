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
const percelRoute = require("../routes/percelRoute");

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
app.use("/api", percelRoute);

// ================= HTTP SERVER =================
const server = http.createServer(app);

// ================= SOCKET.IO =================
const io = new Server(server, {
  transports: ["polling", "websocket"],
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
const rideOffers = new Map(); // rideId -> { offeredAt, offeredTo: [driverIds], acceptedBy: driverId }

global.io = io;
global.driverSockets = driverSockets;
global.riderSockets = riderSockets;
global.rideOffers = rideOffers;

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

    // Send pending rides assigned to this driver
    try {
      const pendingRides = await Ride.find({
        driver: dId,
        status: { $in: ["requested", "accepted", "arrived"] },
      });

      pendingRides.forEach((ride) => {
        io.to(socket.id).emit("rideAssigned", {
          rideId: ride._id.toString(),
          pickup: ride.pickup,
          destination: ride.destination,
          passengerName: ride.passengers?.[0]?.name || "Passenger",
          fare: ride.basePrice,
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

  // ---------- ACCEPT RIDE (ATOMIC - Only one driver can accept) ----------
  socket.on("acceptRide", async ({ rideId, driverId }) => {
    try {
      console.log(
        `\n🚗 Driver ${driverId} attempting to accept ride ${rideId}`,
      );

      // ✅ ATOMIC UPDATE - Only one driver can match these conditions
      const ride = await Ride.findOneAndUpdate(
        {
          _id: rideId,
          status: "pending",
          driver: null,
        },
        {
          status: "accepted",
          driver: driverId,
          acceptedAt: new Date(),
        },
        { new: true },
      );

      if (!ride) {
        console.log(`⚠️ Ride ${rideId} already taken or invalid state`);
        socket.emit("rideTaken", {
          rideId,
          message: "Sorry, another driver already accepted this ride",
        });
        return;
      }

      console.log(`✅ Ride ${rideId} accepted by driver ${driverId}`);

      // Update ride offer tracking
      if (global.rideOffers.has(rideId)) {
        global.rideOffers.get(rideId).acceptedBy = driverId;
      }

      // ✅ Notify the accepting driver
      socket.emit("rideAccepted", {
        rideId: ride._id.toString(),
        message: "Ride accepted successfully!",
        ride,
      });

      // 📢 NOTIFY ALL OTHER DRIVERS - Ride is taken
      console.log(`📢 Notifying other drivers that ride is taken...`);
      const allDriverSockets = Array.from(driverSockets.values());
      allDriverSockets.forEach((otherSocketId) => {
        if (otherSocketId !== socket.id) {
          io.to(otherSocketId).emit("rideTaken", {
            rideId: rideId.toString(),
            message: "This ride has been accepted by another driver",
          });
        }
      });

      // 📱 Notify the passenger (rider)
      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("driverAccepted", {
            rideId: ride._id.toString(),
            driverId,
            message: "A driver has accepted your ride!",
          });
        }
      }

      console.log("");
    } catch (err) {
      console.error("❌ Accept ride error:", err.message);
      socket.emit("rideAcceptError", {
        message: "Failed to accept ride",
        error: err.message,
      });
    }
  });

  // ---------- DRIVER ARRIVED AT PICKUP ----------
  socket.on("arrivedAtPickup", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "accepted", driver: driverId },
        { status: "arrived", arrivedAt: new Date() },
        { new: true },
      );

      if (!ride) {
        return socket.emit("invalidAction", {
          message: "Ride not in accepted status",
        });
      }

      console.log(`🚦 Driver ${driverId} arrived at pickup for ride ${rideId}`);

      // ✅ Notify driver
      socket.emit("pickupConfirmed", { ride });

      // Notify rider
      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("driverArrived", {
            rideId: ride._id.toString(),
            driverId,
            message: "Your driver has arrived!",
            ride, // ✅ Include full ride object
          });
        }
      }
    } catch (err) {
      console.error("❌ Arrived at pickup error:", err.message);
    }
  });

  // ---------- PICKED UP PASSENGER / START TRIP ----------
  socket.on("pickedUpPassenger", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "arrived", driver: driverId },
        { status: "ongoing", startedAt: new Date() },
        { new: true },
      );

      if (!ride) {
        return socket.emit("invalidAction", {
          message: "Ride not in arrived status",
        });
      }

      console.log(`🚀 Trip started for ride ${rideId}`);

      // ✅ Notify DRIVER with full ride object
      socket.emit("tripStarted", { ride });

      // ✅ Notify rider with full ride object
      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("rideOngoing", {
            rideId: ride._id.toString(),
            driverId,
            message: "Trip in progress",
            ride, // ✅ Include full ride object
          });
        }
      }
    } catch (err) {
      console.error("❌ Start trip error:", err.message);
    }
  });

  // ---------- END TRIP ----------
  socket.on("endTrip", async ({ rideId, driverId }) => {
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "ongoing", driver: driverId },
        { status: "completed", completedAt: new Date() },
        { new: true },
      );

      if (!ride) {
        return socket.emit("invalidAction", { message: "Ride not ongoing" });
      }

      console.log(`🏁 Ride ${rideId} completed by driver ${driverId}`);

      // ✅ Notify DRIVER with full ride object
      socket.emit("tripEnded", { ride });

      // ✅ Notify RIDER with full ride object
      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("rideCompleted", {
            rideId: ride._id.toString(),
            driverId,
            message: "Your ride is complete",
            ride, // ✅ Include full ride object
          });
        }
      }
    } catch (err) {
      console.error("❌ End trip error:", err.message);
    }
  });

  // ---------- REJECT RIDE ----------
  socket.on("rejectRide", async ({ rideId, driverId }) => {
    try {
      console.log(`❌ Driver ${driverId} rejected ride ${rideId}`);

      const rideOffer = global.rideOffers.get(rideId);
      if (!rideOffer || rideOffer.acceptedBy) {
        return socket.emit("rideAlreadyTaken", { rideId });
      }

      await Ride.findByIdAndUpdate(rideId, {
        $push: { rejectedBy: driverId },
      });

      if (rideOffer) {
        rideOffer.offeredTo = rideOffer.offeredTo.filter(
          (id) => id !== driverId,
        );

        if (rideOffer.offeredTo.length === 0) {
          await Ride.findByIdAndUpdate(rideId, {
            status: "no_drivers_available",
          });
          console.log(`📭 All drivers rejected ride ${rideId}`);
        }
      }

      socket.emit("rideRejected", { rideId });
    } catch (err) {
      console.error("❌ Reject ride error:", err.message);
    }
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
