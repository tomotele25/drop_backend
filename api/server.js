require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const cron = require("node-cron");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const connectToDb = require("../database/db");
const { createOfferStore } = require("../utils/offerStore");

// Routes
const authRoute = require("../routes/authRoute");
const rideRoute = require("../routes/rideRoute");
const riderRoute = require("../routes/riderRoute");
const percelRoute = require("../routes/percelRoute");
const carpoolRoute = require("../routes/carpoolRoute");
const walletRoute = require("../routes/walletRoute");
const paymentRoute = require("../routes/paymentRoute");
const payoutRoute = require("../routes/payoutRoute");
const pushRoute = require("../routes/pushRoute");
const { runDailySettlement } = require("../controller/payout");

// Models
const Ride = require("../model/ride");
const { settleDriverEarning, expireStalePendingRides } = require("../controller/rides");
const Rider = require("../model/rider");
const CarpoolRoom = require("../model/carpool");

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
// The Paystack webhook needs the exact raw bytes of the request body to
// verify the signature — it must be mounted with express.raw() BEFORE the
// global express.json() below, or the body would already be parsed/mutated
// by the time the webhook handler sees it.
app.use("/api/paystack/webhook", express.raw({ type: "application/json" }));
app.use(express.json());

// ================= ROUTES =================
// payoutRoute has specific paths under /rider/... (banks, bank-details,
// earnings) that were silently shadowed by rideRoute's GET /rider/:id
// wildcard when rideRoute was mounted first — Express matches routes in
// registration order, so "/rider/earnings" was matching :id="earnings"
// and hitting getRiderById (Rider.findById("earnings") → CastError → a
// generic 500 with no useful log, from a completely different handler than
// intended). Specific routes now mount before the wildcard-containing ones.
app.get("/", (_, res) => res.send("🚀 Server is running"));
app.use("/api", authRoute);
app.use("/api", payoutRoute);
app.use("/api", walletRoute);
app.use("/api", paymentRoute);
app.use("/api", pushRoute);
app.use("/api", rideRoute);
app.use("/api", riderRoute);
app.use("/api", percelRoute);
app.use("/api/carpool", carpoolRoute);

// ================= GLOBAL ERROR HANDLER =================
// Catches anything a route/middleware passes to next(err) or throws
// synchronously (e.g. multer/cloudinary upload failures) instead of the
// default Express handler, which for non-Error objects just renders
// "[object Object]" with no useful detail.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Server error",
  });
});

// ================= DAILY PAYOUT SETTLEMENT =================
// Runs at 01:00 server time — batches every driver's earnings from
// completed rides into one payout per driver via Paystack transfer.
// NOTE: node-cron only works on a long-running process (this only fires
// reliably under `node server.js`, not on a serverless/Vercel deployment
// where the process doesn't stay alive between requests — same caveat as
// the in-memory socket maps elsewhere in this file).
cron.schedule("0 1 * * *", async () => {
  console.log("⏰ Running daily driver payout settlement...");
  try {
    await runDailySettlement();
  } catch (err) {
    console.error("❌ Daily settlement run failed:", err.message);
  }
});

// ================= STALE RIDE-OFFER EXPIRY =================
// Every 30s, expire any paid ride that's been broadcast to drivers but sat
// unaccepted past RIDE_OFFER_TIMEOUT_MS — previously these hung "pending"
// forever with no way for the customer to know it failed.
cron.schedule("*/30 * * * * *", async () => {
  try {
    await expireStalePendingRides();
  } catch (err) {
    console.error("❌ Ride expiry sweep failed:", err.message);
  }
});

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

// ================= SOCKET AUTHENTICATION =================
// Previously registerDriver/registerRider/driverLocation trusted whatever
// ID the client sent in the event payload — anyone could register as any
// driver ID and receive their ride offers, or spoof another driver's GPS
// location. Every socket now must present a valid JWT at connection time;
// the identity it carries (not anything the client emits afterward) is
// what the handlers below trust.
io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.authorization?.split(" ")[1];

  if (!token) return next(new Error("Authentication required"));

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error("Invalid or expired token"));
    socket.data.userId = decoded.id;
    socket.data.role = decoded.role;
    socket.data.riderId = decoded.riderId || null;
    next();
  });
});

// ================= GLOBAL SOCKET MAPS =================
const driverSockets = new Map(); // driverId   -> socketId
const riderSockets = new Map(); // riderId    -> socketId
const socketDrivers = new Map(); // socketId   -> driverId
const socketRiders = new Map(); // socketId   -> riderId

// rideId/roomId -> { offeredAt, offeredTo, acceptedBy } — write-through to
// Redis when REDIS_URL is configured, so an in-flight dispatch survives a
// server restart instead of silently vanishing. Falls back to plain
// in-memory behavior (old behavior, unchanged) when it isn't.
const rideOffers = createOfferStore("rideOffers");
const carpoolOffers = createOfferStore("carpoolOffers");
rideOffers.hydrate();
carpoolOffers.hydrate();

global.io = io;
global.driverSockets = driverSockets;
global.riderSockets = riderSockets;
global.rideOffers = rideOffers;
global.carpoolOffers = carpoolOffers;

// ================= HELPERS =================

/**
 * Haversine distance in km
 */
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find online drivers sorted by proximity to a coordinate.
 * Excludes drivers already offered/rejected/accepted for this room.
 */
async function findNearbyOnlineDrivers(
  lat,
  lng,
  excludeIds = [],
  radiusKm = 20,
) {
  // Only look up drivers that have an active socket connection
  const onlineDriverIds = Array.from(driverSockets.keys()).filter(
    (id) => !excludeIds.includes(id),
  );

  if (onlineDriverIds.length === 0) return [];

  // Fetch their last known locations from DB
  const drivers = await Rider.find({
    _id: { $in: onlineDriverIds },
    isActive: true,
    currentLocation: { $exists: true },
  }).select("_id fullname currentLocation carModel carColor plateNo");

  // Filter by radius and sort closest first
  return drivers
    .map((d) => {
      const dist = getDistanceKm(
        lat,
        lng,
        d.currentLocation?.latitude ?? 0,
        d.currentLocation?.longitude ?? 0,
      );
      return { driver: d, distance: dist };
    })
    .filter(({ distance }) => distance <= radiusKm)
    .sort((a, b) => a.distance - b.distance)
    .map(({ driver }) => driver);
}

/**
 * Offer a carpool room to the next available driver.
 * Called recursively as drivers reject.
 */
async function offerCarpoolRoomToNextDriver(room, alreadyOfferedIds = []) {
  const { pickupCoordinates, _id: roomId } = room;

  if (!pickupCoordinates?.latitude) {
    console.log(
      `⚠️  Room ${roomId} has no pickup coordinates — skipping assignment`,
    );
    return;
  }

  const candidates = await findNearbyOnlineDrivers(
    pickupCoordinates.latitude,
    pickupCoordinates.longitude,
    alreadyOfferedIds,
  );

  if (candidates.length === 0) {
    console.log(`📭 No available drivers for carpool room ${roomId}`);

    // Mark room as unassigned so admin can see
    await CarpoolRoom.findByIdAndUpdate(roomId, { status: "waiting" });

    // Notify all passengers in the room
    room.passengers?.forEach((p) => {
      const riderSocketId = riderSockets.get(p.userId?.toString());
      if (riderSocketId) {
        io.to(riderSocketId).emit("carpoolNoDrivers", {
          roomId: roomId.toString(),
          message:
            "No drivers available near the pickup point right now. We'll keep looking.",
        });
      }
    });
    return;
  }

  // Offer to the nearest driver
  const nextDriver = candidates[0];
  const driverSocketId = driverSockets.get(nextDriver._id.toString());

  if (!driverSocketId) {
    // Socket disappeared — skip this driver
    return offerCarpoolRoomToNextDriver(room, [
      ...alreadyOfferedIds,
      nextDriver._id.toString(),
    ]);
  }

  // Track offer
  if (!carpoolOffers.has(roomId.toString())) {
    carpoolOffers.set(roomId.toString(), { offeredTo: [], acceptedBy: null });
  }
  const offerMeta = carpoolOffers.get(roomId.toString());
  offerMeta.offeredTo.push(nextDriver._id.toString());
  carpoolOffers.set(roomId.toString(), offerMeta); // write-through the mutation

  console.log(
    `📤 Carpool room ${roomId} offered to driver ${nextDriver._id} (${nextDriver.fullname})`,
  );

  io.to(driverSocketId).emit("carpoolRoomOffer", {
    roomId: roomId.toString(),
    route: room.route,
    pickup: room.pickup,
    destination: room.destination,
    price: room.price,
    rideType: room.rideType,
    distance: room.distance,
    duration: room.duration,
    departureTime: room.departureTime,
    passengerCount: room.passengers?.length ?? 0,
    maxPassengers: room.maxPassengers,
    // Driver has 60 seconds to respond
    expiresAt: Date.now() + 60_000,
  });

  // Auto-expire if driver doesn't respond in 60 s
  setTimeout(async () => {
    const meta = carpoolOffers.get(roomId.toString());
    if (meta && !meta.acceptedBy) {
      console.log(
        `⏰ Carpool offer to driver ${nextDriver._id} expired for room ${roomId}`,
      );
      io.to(driverSocketId).emit("carpoolOfferExpired", {
        roomId: roomId.toString(),
      });
      // Try next driver
      const freshRoom = await CarpoolRoom.findById(roomId);
      if (freshRoom && freshRoom.status === "waiting") {
        offerCarpoolRoomToNextDriver(freshRoom, offerMeta.offeredTo);
      }
    }
  }, 60_000);
}

// Export so carpoolController can call it after room creation
global.offerCarpoolRoomToNextDriver = offerCarpoolRoomToNextDriver;

// ================= SOCKET CONNECTION =================
io.on("connection", (socket) => {
  console.log("🔌 Socket connected:", socket.id);

  // ---------- REGISTER DRIVER ----------
  socket.on("registerDriver", async () => {
    // The client-supplied driverId is gone — this driver's own riderId
    // came from their verified JWT at connection time, so there's no way
    // to register as someone else's driver ID anymore.
    if (socket.data.role !== "rider" || !socket.data.riderId) {
      return socket.emit("registerError", { message: "Not authorized as a driver" });
    }

    const dId = socket.data.riderId.toString();
    driverSockets.set(dId, socket.id);
    socketDrivers.set(socket.id, dId);

    console.log(`🚗 Driver registered: ${dId}`);

    // Replay pending standard rides
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

    // Replay any carpool rooms assigned to this driver that are still in_progress
    try {
      const assignedRooms = await CarpoolRoom.find({
        driverId: dId,
        status: { $in: ["assigned", "in_progress"] },
      });

      assignedRooms.forEach((room) => {
        io.to(socket.id).emit("carpoolRoomAssigned", {
          roomId: room._id.toString(),
          route: room.route,
          pickup: room.pickup,
          destination: room.destination,
          price: room.price,
          rideType: room.rideType,
          distance: room.distance,
          duration: room.duration,
          departureTime: room.departureTime,
          passengerCount: room.passengers?.length ?? 0,
          status: room.status,
        });
      });
    } catch (err) {
      console.error("❌ Pending carpool room replay error:", err.message);
    }
  });

  // ---------- REGISTER RIDER ----------
  socket.on("registerRider", () => {
    // "riderId" here means the passenger's User id (naming collision with
    // the Rider/driver model elsewhere in this codebase) — taken from the
    // verified JWT, not the client payload.
    if (!socket.data.userId) return;

    const rId = socket.data.userId.toString();
    riderSockets.set(rId, socket.id);
    socketRiders.set(socket.id, rId);

    console.log(`🧍 Rider registered: ${rId}`);
  });

  // ---------- DRIVER LOCATION UPDATE ----------
  socket.on("driverLocation", async ({ lat, lng }) => {
    // driverId no longer comes from the client — a socket can now only ever
    // update its own authenticated driver's location, never spoof another's.
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    if (lat == null || lng == null) return;

    const driverId = socket.data.riderId;

    try {
      await Rider.findByIdAndUpdate(driverId, {
        currentLocation: { latitude: lat, longitude: lng },
        location: { type: "Point", coordinates: [lng, lat] },
      });

      socket.broadcast.emit("locationUpdate", { driverId, lat, lng });
    } catch (err) {
      console.error("❌ Location update error:", err.message);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // CARPOOL ROOM EVENTS
  // ─────────────────────────────────────────────────────────────────

  // ---------- DRIVER ACCEPTS CARPOOL ROOM OFFER ----------
  socket.on("acceptCarpoolRoom", async ({ roomId }) => {
    // driverId is the socket's own authenticated identity now, never a
    // client-supplied value — closes the "accept on behalf of another
    // driver" spoofing hole.
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      console.log(`\n🚗 Driver ${driverId} accepting carpool room ${roomId}`);

      const offerMeta = carpoolOffers.get(roomId.toString());
      if (offerMeta?.acceptedBy) {
        // Another driver already accepted
        socket.emit("carpoolRoomTaken", {
          roomId,
          message: "Another driver already accepted this room",
        });
        return;
      }

      // Fetch full driver info
      const driver = await Rider.findById(driverId).select(
        "fullname carModel carColor plateNo",
      );

      if (!driver) {
        socket.emit("carpoolAcceptError", { message: "Driver not found" });
        return;
      }

      // ATOMIC: only assign if still waiting
      const room = await CarpoolRoom.findOneAndUpdate(
        { _id: roomId, status: "waiting" },
        {
          status: "assigned",
          driverId,
          driverName: driver.fullname,
          carModel: driver.carModel,
          carColor: driver.carColor,
          plateNo: driver.plateNo,
        },
        { new: true },
      );

      if (!room) {
        socket.emit("carpoolRoomTaken", {
          roomId,
          message: "Room is no longer available",
        });
        return;
      }

      // Track acceptance — goes back through .set() so the write-through
      // to Redis actually captures it, not just the in-memory cache.
      if (offerMeta) {
        offerMeta.acceptedBy = driverId;
        carpoolOffers.set(roomId.toString(), offerMeta);
      }

      console.log(
        `✅ Carpool room ${roomId} assigned to driver ${driverId} (${driver.fullname})`,
      );

      // Confirm to accepting driver
      socket.emit("carpoolRoomAccepted", {
        roomId: room._id.toString(),
        message: "Carpool room accepted! Head to the pickup point.",
        room,
      });

      // Notify ALL passengers in the room
      room.passengers?.forEach((p) => {
        const riderSocketId = riderSockets.get(p.userId?.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("carpoolDriverAssigned", {
            roomId: room._id.toString(),
            driverName: driver.fullname,
            carModel: driver.carModel,
            carColor: driver.carColor,
            plateNo: driver.plateNo,
            message: `Your driver ${driver.fullname} has been assigned!`,
          });
        }
      });

      // Tell other offered drivers the room is taken
      if (offerMeta) {
        offerMeta.offeredTo.forEach((offeredDriverId) => {
          if (offeredDriverId !== driverId.toString()) {
            const otherSocketId = driverSockets.get(offeredDriverId);
            if (otherSocketId) {
              io.to(otherSocketId).emit("carpoolRoomTaken", {
                roomId,
                message:
                  "This carpool room has been assigned to another driver",
              });
            }
          }
        });
      }

      // Broadcast room update to all connected clients (passenger list view)
      io.emit("carpoolRoomUpdated", {
        roomId: room._id.toString(),
        status: "assigned",
        driverName: driver.fullname,
      });

      console.log("");
    } catch (err) {
      console.error("❌ Accept carpool room error:", err.message);
      socket.emit("carpoolAcceptError", {
        message: "Failed to accept carpool room",
        error: err.message,
      });
    }
  });

  // ---------- DRIVER REJECTS CARPOOL ROOM OFFER ----------
  socket.on("rejectCarpoolRoom", async ({ roomId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      console.log(`❌ Driver ${driverId} rejected carpool room ${roomId}`);

      const offerMeta = carpoolOffers.get(roomId.toString());
      if (offerMeta?.acceptedBy) return; // Already taken

      socket.emit("carpoolRoomRejected", { roomId });

      // Move on to the next driver
      const room = await CarpoolRoom.findById(roomId);
      if (room && room.status === "waiting") {
        const alreadyOffered = offerMeta?.offeredTo ?? [driverId];
        offerCarpoolRoomToNextDriver(room, alreadyOffered);
      }
    } catch (err) {
      console.error("❌ Reject carpool room error:", err.message);
    }
  });

  // ---------- DRIVER STARTS CARPOOL RIDE ----------
  socket.on("startCarpoolRide", async ({ roomId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      const room = await CarpoolRoom.findOneAndUpdate(
        { _id: roomId, status: "assigned", driverId },
        { status: "in_progress", startedAt: new Date() },
        { new: true },
      );

      if (!room) {
        return socket.emit("invalidAction", {
          message: "Room not in assigned status",
        });
      }

      console.log(`🚀 Carpool ride started: ${roomId}`);
      socket.emit("carpoolRideStartedConfirm", { room });

      // Notify all checked-in passengers
      room.passengers?.forEach((p) => {
        const riderSocketId = riderSockets.get(p.userId?.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("carpoolRideStarted", {
            roomId: room._id.toString(),
            message: "Your carpool ride has started! Enjoy the trip.",
          });
        }
      });

      io.emit("carpoolRoomUpdated", {
        roomId: room._id.toString(),
        status: "in_progress",
      });
    } catch (err) {
      console.error("❌ Start carpool ride error:", err.message);
    }
  });

  // ---------- DRIVER COMPLETES CARPOOL RIDE ----------
  socket.on("completeCarpoolRide", async ({ roomId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      const room = await CarpoolRoom.findOneAndUpdate(
        { _id: roomId, status: "in_progress", driverId },
        { status: "completed", completedAt: new Date() },
        { new: true },
      );

      if (!room) {
        return socket.emit("invalidAction", {
          message: "Room not in progress",
        });
      }

      console.log(`🏁 Carpool ride completed: ${roomId}`);
      socket.emit("carpoolRideCompletedConfirm", { room });

      room.passengers?.forEach((p) => {
        const riderSocketId = riderSockets.get(p.userId?.toString());
        if (riderSocketId) {
          io.to(riderSocketId).emit("carpoolRideCompleted", {
            roomId: room._id.toString(),
            message: "You've arrived! Thanks for carpooling with Drop.",
          });
        }
      });

      io.emit("carpoolRoomUpdated", {
        roomId: room._id.toString(),
        status: "completed",
      });

      // Clean up offer meta
      carpoolOffers.delete(roomId.toString());
    } catch (err) {
      console.error("❌ Complete carpool ride error:", err.message);
    }
  });

  // ---------- PASSENGER JOINS ROOM (real-time update to driver) ----------
  socket.on(
    "passengerJoinedCarpool",
    ({ roomId, passengerName, passengerCount }) => {
      const room = CarpoolRoom.findById(roomId);
      if (!room) return;

      // Find driver's socket and notify
      // We look up via roomId → driverId → socketId
      CarpoolRoom.findById(roomId)
        .then((r) => {
          if (!r?.driverId) return;
          const driverSocketId = driverSockets.get(r.driverId.toString());
          if (driverSocketId) {
            io.to(driverSocketId).emit("carpoolPassengerJoined", {
              roomId,
              passengerName,
              passengerCount,
              message: `${passengerName} joined your carpool room`,
            });
          }
        })
        .catch(() => {});
    },
  );

  // ─────────────────────────────────────────────────────────────────
  // STANDARD RIDE EVENTS (unchanged)
  // ─────────────────────────────────────────────────────────────────

  socket.on("acceptRide", async ({ rideId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      console.log(
        `\n🚗 Driver ${driverId} attempting to accept ride ${rideId}`,
      );

      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "pending", driver: null },
        { status: "accepted", driver: driverId, acceptedAt: new Date() },
        { new: true },
      );

      if (!ride) {
        console.log(`⚠️ Ride ${rideId} already taken`);
        socket.emit("rideTaken", {
          rideId,
          message: "Sorry, another driver already accepted this ride",
        });
        return;
      }

      console.log(`✅ Ride ${rideId} accepted by driver ${driverId}`);

      if (global.rideOffers.has(rideId)) {
        // Mutating the returned object in place would only update the
        // in-memory cache — it needs to go back through .set() to actually
        // write-through to Redis and be durable across a restart.
        const offer = global.rideOffers.get(rideId);
        offer.acceptedBy = driverId;
        global.rideOffers.set(rideId, offer);
      }

      socket.emit("rideAccepted", {
        rideId: ride._id.toString(),
        message: "Ride accepted successfully!",
        ride,
      });

      Array.from(driverSockets.values()).forEach((otherSocketId) => {
        if (otherSocketId !== socket.id) {
          io.to(otherSocketId).emit("rideTaken", {
            rideId: rideId.toString(),
            message: "This ride has been accepted by another driver",
          });
        }
      });

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
    } catch (err) {
      console.error("❌ Accept ride error:", err.message);
      socket.emit("rideAcceptError", {
        message: "Failed to accept ride",
        error: err.message,
      });
    }
  });

  socket.on("arrivedAtPickup", async ({ rideId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "accepted", driver: driverId },
        { status: "arrived", arrivedAt: new Date() },
        { new: true },
      );

      if (!ride)
        return socket.emit("invalidAction", {
          message: "Ride not in accepted status",
        });

      console.log(`🚦 Driver ${driverId} arrived at pickup for ride ${rideId}`);
      socket.emit("pickupConfirmed", { ride });

      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId)
          io.to(riderSocketId).emit("driverArrived", {
            rideId: ride._id.toString(),
            driverId,
            message: "Your driver has arrived!",
            ride,
          });
      }
    } catch (err) {
      console.error("❌ Arrived at pickup error:", err.message);
    }
  });

  socket.on("pickedUpPassenger", async ({ rideId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "arrived", driver: driverId },
        { status: "ongoing", startedAt: new Date() },
        { new: true },
      );

      if (!ride)
        return socket.emit("invalidAction", {
          message: "Ride not in arrived status",
        });

      console.log(`🚀 Trip started for ride ${rideId}`);
      socket.emit("tripStarted", { ride });

      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId)
          io.to(riderSocketId).emit("rideOngoing", {
            rideId: ride._id.toString(),
            driverId,
            message: "Trip in progress",
            ride,
          });
      }
    } catch (err) {
      console.error("❌ Start trip error:", err.message);
    }
  });

  socket.on("endTrip", async ({ rideId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "ongoing", driver: driverId },
        { status: "completed", completedAt: new Date() },
        { new: true },
      );

      if (!ride)
        return socket.emit("invalidAction", { message: "Ride not ongoing" });

      await settleDriverEarning(ride);

      console.log(`🏁 Ride ${rideId} completed by driver ${driverId}`);
      socket.emit("tripEnded", { ride });

      const passengerId = ride.passengers?.[0]?.userId;
      if (passengerId) {
        const riderSocketId = riderSockets.get(passengerId.toString());
        if (riderSocketId)
          io.to(riderSocketId).emit("rideCompleted", {
            rideId: ride._id.toString(),
            driverId,
            message: "Your ride is complete",
            ride,
          });
      }
    } catch (err) {
      console.error("❌ End trip error:", err.message);
    }
  });

  socket.on("rejectRide", async ({ rideId }) => {
    if (socket.data.role !== "rider" || !socket.data.riderId) return;
    const driverId = socket.data.riderId.toString();
    try {
      console.log(`❌ Driver ${driverId} rejected ride ${rideId}`);

      const rideOffer = global.rideOffers.get(rideId);
      if (!rideOffer || rideOffer.acceptedBy)
        return socket.emit("rideAlreadyTaken", { rideId });

      await Ride.findByIdAndUpdate(rideId, { $push: { rejectedBy: driverId } });

      if (rideOffer) {
        rideOffer.offeredTo = rideOffer.offeredTo.filter(
          (id) => id !== driverId,
        );
        global.rideOffers.set(rideId, rideOffer); // write-through the mutation
        if (rideOffer.offeredTo.length === 0) {
          await Ride.findOneAndUpdate(
            { _id: rideId, status: "pending" },
            { status: "no_drivers_available" },
          );
          console.log(`📭 All drivers rejected ride ${rideId}`);
        }
      }

      socket.emit("rideRejected", { rideId });
    } catch (err) {
      console.error("❌ Reject ride error:", err.message);
    }
  });

  // ---------- ROOM UTILITIES ----------
  socket.on("joinRoom", (roomId) => {
    socket.join(roomId);
    console.log(`🚗 Socket ${socket.id} joined room ${roomId}`);
  });

  socket.on("leaveRoom", (roomId) => {
    socket.leave(roomId);
    console.log(`🚪 Socket ${socket.id} left room ${roomId}`);
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
