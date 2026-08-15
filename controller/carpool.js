require("dotenv").config();

const CarpoolRoom = require("../model/carpool");
const Rider = require("../model/rider");
const axios = require("axios");

// ================= HELPERS =================

const getDistanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ================= CREATE CARPOOL ROOM =================
const createRoom = async (req, res) => {
  try {
    const {
      pickup,
      destination,
      price,
      maxPassengers,
      departureTime,
      rideType,
    } = req.body;
    const driverId = req.user?._id;

    if (!pickup || !destination || !departureTime) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Pickup, destination, and departure time are required",
        });
    }

    if (!price) {
      return res
        .status(400)
        .json({ success: false, message: "Price is required" });
    }

    if (price < 100 || price > 50000) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Price must be between ₦100 and ₦50,000",
        });
    }

    const departureDate = new Date(departureTime);
    if (departureDate < new Date()) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Departure time must be in the future",
        });
    }

    // GEOCODE PICKUP
    const pickupGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: { address: pickup, key: process.env.GOOGLE_MAPS_API_KEY },
      },
    );

    if (pickupGeo.data.status !== "OK") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid pickup address" });
    }

    const pickupLoc = pickupGeo.data.results[0].geometry.location;

    // GEOCODE DESTINATION
    const destinationGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: { address: destination, key: process.env.GOOGLE_MAPS_API_KEY },
      },
    );

    if (destinationGeo.data.status !== "OK") {
      return res
        .status(400)
        .json({ success: false, message: "Invalid destination address" });
    }

    const destinationLoc = destinationGeo.data.results[0].geometry.location;

    // GET DIRECTIONS
    const directionsRes = await axios.get(
      "https://maps.googleapis.com/maps/api/directions/json",
      {
        params: {
          origin: `${pickupLoc.lat},${pickupLoc.lng}`,
          destination: `${destinationLoc.lat},${destinationLoc.lng}`,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );

    if (directionsRes.data.status !== "OK") {
      return res
        .status(400)
        .json({ success: false, message: "Unable to calculate route" });
    }

    const leg = directionsRes.data.routes[0].legs[0];
    const distance = Number((leg.distance.value / 1000).toFixed(2));
    const duration = Math.ceil(leg.duration.value / 60);

    // GET DRIVER DETAILS (if logged in as driver)
    let driverData = {
      driverId: null,
      driverName: "Admin",
      carModel: null,
      carColor: null,
      plateNo: null,
    };

    if (driverId) {
      try {
        const driver = await Rider.findById(driverId).select(
          "fullname carModel carColor plateNo",
        );
        if (driver) {
          driverData = {
            driverId,
            driverName: driver.fullname,
            carModel: driver.carModel,
            carColor: driver.carColor,
            plateNo: driver.plateNo,
          };
        }
      } catch {
        console.log("Driver not found, using defaults");
      }
    }

    // CREATE ROOM
    const room = await CarpoolRoom.create({
      route: `${pickup} → ${destination}`,
      pickup,
      destination,
      pickupCoordinates: { latitude: pickupLoc.lat, longitude: pickupLoc.lng },
      destinationCoordinates: {
        latitude: destinationLoc.lat,
        longitude: destinationLoc.lng,
      },
      price: Number(price),
      rideType: rideType || "Standard",
      maxPassengers: maxPassengers || 5,
      ...driverData,
      departureTime: new Date(departureTime),
      distance,
      duration,
      status: "waiting",
      passengers: [],
    });

    console.log(
      `✅ Carpool room created: ${room._id} | Route: ${room.route} | Price: ₦${room.price}`,
    );

    // BROADCAST new room to all connected clients (passenger-side)
    if (global.io) {
      global.io.emit("newCarpoolRoom", {
        roomId: room._id,
        route: room.route,
        pickup: room.pickup,
        destination: room.destination,
        price: room.price,
        rideType: room.rideType,
        distance: room.distance,
        duration: room.duration,
        departureTime: room.departureTime,
        passengerCount: 0,
        maxPassengers: room.maxPassengers,
      });
    }

    // If room was created by admin (no pre-assigned driver), find and notify a nearby driver
    if (!driverId && global.offerCarpoolRoomToNextDriver) {
      console.log(`🔍 Looking for available drivers for room ${room._id}…`);
      // Fire and forget — don't block the HTTP response
      global
        .offerCarpoolRoomToNextDriver(room, [])
        .catch((err) => console.error("❌ Driver offer error:", err.message));
    } else if (driverId) {
      // Room was self-created by a driver — mark as assigned immediately
      await CarpoolRoom.findByIdAndUpdate(room._id, { status: "assigned" });

      // Confirm to that driver via socket
      const driverSocketId = global.driverSockets?.get(driverId.toString());
      if (driverSocketId && global.io) {
        global.io.to(driverSocketId).emit("carpoolRoomAssigned", {
          roomId: room._id.toString(),
          route: room.route,
          pickup: room.pickup,
          destination: room.destination,
          price: room.price,
          rideType: room.rideType,
          distance: room.distance,
          duration: room.duration,
          departureTime: room.departureTime,
          passengerCount: 0,
          maxPassengers: room.maxPassengers,
          status: "assigned",
        });
      }
    }

    return res
      .status(201)
      .json({
        success: true,
        message: "✅ Carpool room created successfully",
        room,
      });
  } catch (error) {
    console.error("❌ Create room error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error creating room",
        error: error.message,
      });
  }
};

// ================= MANUALLY ASSIGN DRIVER TO ROOM =================
const assignDriver = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res
        .status(400)
        .json({ success: false, message: "driverId is required" });
    }

    const driver = await Rider.findById(driverId).select(
      "fullname carModel carColor plateNo",
    );
    if (!driver)
      return res
        .status(404)
        .json({ success: false, message: "Driver not found" });

    // Single atomic, status-guarded update — replaces the old read-then-write
    // (findById → findByIdAndUpdate) which let two concurrent assign-driver
    // calls both pass the "still waiting" check and both write.
    const updatedRoom = await CarpoolRoom.findOneAndUpdate(
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

    if (!updatedRoom) {
      const existing = await CarpoolRoom.findById(roomId).select("status");
      if (!existing) {
        return res
          .status(404)
          .json({ success: false, message: "Room not found" });
      }
      return res.status(409).json({
        success: false,
        message: `Room is already ${existing.status}`,
      });
    }

    console.log(
      `🔧 Manual assignment: Driver ${driver.fullname} → Room ${roomId}`,
    );

    // Notify the driver via socket
    const driverSocketId = global.driverSockets?.get(driverId.toString());
    if (driverSocketId && global.io) {
      global.io.to(driverSocketId).emit("carpoolRoomOffer", {
        roomId: updatedRoom._id.toString(),
        route: updatedRoom.route,
        pickup: updatedRoom.pickup,
        destination: updatedRoom.destination,
        price: updatedRoom.price,
        rideType: updatedRoom.rideType,
        distance: updatedRoom.distance,
        duration: updatedRoom.duration,
        departureTime: updatedRoom.departureTime,
        passengerCount: updatedRoom.passengers?.length ?? 0,
        maxPassengers: updatedRoom.maxPassengers,
        manualAssignment: true,
        expiresAt: null, // No timeout for manual assignments
      });
    } else {
      console.log(`⚠️  Driver ${driverId} is not currently online`);
    }

    // Notify passengers
    updatedRoom.passengers?.forEach((p) => {
      const riderSocketId = global.riderSockets?.get(p.userId?.toString());
      if (riderSocketId && global.io) {
        global.io.to(riderSocketId).emit("carpoolDriverAssigned", {
          roomId: updatedRoom._id.toString(),
          driverName: driver.fullname,
          carModel: driver.carModel,
          carColor: driver.carColor,
          plateNo: driver.plateNo,
          message: `Driver ${driver.fullname} has been assigned to your carpool!`,
        });
      }
    });

    if (global.io) {
      global.io.emit("carpoolRoomUpdated", {
        roomId: updatedRoom._id.toString(),
        status: "assigned",
        driverName: driver.fullname,
      });
    }

    return res
      .status(200)
      .json({
        success: true,
        message: "Driver assigned successfully",
        room: updatedRoom,
      });
  } catch (error) {
    console.error("❌ Assign driver error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error assigning driver",
        error: error.message,
      });
  }
};

// ================= RETRY DRIVER SEARCH =================
const retryDriverSearch = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.status !== "waiting") {
      return res
        .status(400)
        .json({
          success: false,
          message: `Room is ${room.status} — cannot retry search`,
        });
    }

    if (!global.offerCarpoolRoomToNextDriver) {
      return res
        .status(503)
        .json({ success: false, message: "Socket server not available" });
    }

    const existingOffer = global.carpoolOffers?.get(roomId.toString());
    const alreadyOffered = existingOffer?.offeredTo ?? [];

    global
      .offerCarpoolRoomToNextDriver(room, alreadyOffered)
      .catch((err) => console.error("❌ Retry offer error:", err.message));

    console.log(`🔄 Retrying driver search for room ${roomId}`);
    return res
      .status(200)
      .json({ success: true, message: "Driver search restarted" });
  } catch (error) {
    console.error("❌ Retry driver search error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// ================= GET ALL ROOMS =================
const getAllRooms = async (req, res) => {
  try {
    const { status } = req.query;

    const query = { departureTime: { $gte: new Date() } };

    if (status && status !== "all") {
      query.status = status;
    } else {
      query.status = "waiting";
    }

    const rooms = await CarpoolRoom.find(query)
      .populate("driverId", "fullname carModel carColor plateNo")
      .sort({ departureTime: 1 })
      .lean();

    console.log(
      `📋 Fetched ${rooms.length} rooms (status: ${status || "waiting"})`,
    );

    return res
      .status(200)
      .json({
        success: true,
        message: "Carpool rooms fetched successfully",
        rooms,
        count: rooms.length,
      });
  } catch (error) {
    console.error("❌ Get rooms error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching rooms",
        error: error.message,
      });
  }
};

// ================= GET ROOM BY ID =================
const getRoom = async (req, res) => {
  try {
    const { roomId } = req.params;

    const room = await CarpoolRoom.findById(roomId).populate(
      "driverId",
      "fullname carModel carColor plateNo",
    );

    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    return res
      .status(200)
      .json({ success: true, message: "Room fetched successfully", room });
  } catch (error) {
    console.error("❌ Get room error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching room",
        error: error.message,
      });
  }
};

// ================= DELETE ROOM =================
// Soft-cancel, not a hard delete — keeps the record (and its passenger
// list, price, timestamps) for the same reason Ride.cancelRide never
// deletes a ride: you need the audit trail to answer "why did this room
// disappear?" later, and a hard delete would let a completed/in-progress
// room's trip history vanish with no status guard at all.
const cancelRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { reason } = req.body || {};
    const userId = req.user?._id;
    const isAdmin = req.user?.role === "admin";

    const existing = await CarpoolRoom.findById(roomId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    const isAssignedDriver =
      existing.driverId && userId && existing.driverId.toString() === userId.toString();

    // Previously: if driverId was null (no driver assigned yet), the
    // ownership check was skipped entirely, meaning ANY authenticated user
    // could delete any unassigned room. An unassigned room has no other
    // tracked owner, so it's now admin-only until a driver is attached.
    if (!isAdmin && !isAssignedDriver) {
      return res.status(403).json({
        success: false,
        message: existing.driverId
          ? "Only the assigned driver or an admin can cancel this room"
          : "Only an admin can cancel an unassigned room",
      });
    }

    const room = await CarpoolRoom.findOneAndUpdate(
      { _id: roomId, status: { $in: ["waiting", "assigned"] } },
      {
        status: "cancelled",
        cancelledBy: isAdmin ? "admin" : "driver",
        cancelReason: reason || null,
        cancelledAt: new Date(),
      },
      { new: true },
    );

    if (!room) {
      return res.status(409).json({
        success: false,
        message: `Room can no longer be cancelled (already ${existing.status})`,
      });
    }

    if (room.driverId) {
      const driverSocketId = global.driverSockets?.get(room.driverId.toString());
      if (driverSocketId && global.io) {
        global.io.to(driverSocketId).emit("carpoolRoomCancelled", {
          roomId: room._id.toString(),
          message: "This carpool room has been cancelled",
        });
      }
    }

    room.passengers?.forEach((p) => {
      const riderSocketId = global.riderSockets?.get(p.userId?.toString());
      if (riderSocketId && global.io) {
        global.io.to(riderSocketId).emit("carpoolRoomCancelled", {
          roomId: room._id.toString(),
          message: "Your carpool room has been cancelled",
        });
      }
    });

    if (global.io) {
      global.io.emit("carpoolRoomUpdated", {
        roomId: room._id.toString(),
        status: "cancelled",
      });
    }

    console.log(`🚫 Room cancelled: ${roomId} | Route: ${room.route}`);
    return res.status(200).json({ success: true, message: "Room cancelled", room });
  } catch (error) {
    console.error("❌ Cancel room error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error cancelling room",
      error: error.message,
    });
  }
};

// ================= JOIN ROOM =================
const joinRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { name, phone } = req.body;
    const userId = req.user._id;

    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Passenger name is required" });

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (!["waiting", "assigned"].includes(room.status)) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Cannot join a room with status: ${room.status}`,
        });
    }

    if (room.isFull())
      return res.status(400).json({ success: false, message: "Room is full" });

    if (
      room.passengers.some((p) => p.userId.toString() === userId.toString())
    ) {
      return res
        .status(400)
        .json({ success: false, message: "You are already in this room" });
    }

    await room.addPassenger(userId, name, phone);

    console.log(
      `✅ ${name} joined room ${roomId} | ${room.passengers.length}/${room.maxPassengers}`,
    );

    // Notify the assigned driver (if any) about the new passenger
    if (room.driverId) {
      const driverSocketId = global.driverSockets?.get(
        room.driverId.toString(),
      );
      if (driverSocketId && global.io) {
        global.io.to(driverSocketId).emit("carpoolPassengerJoined", {
          roomId: room._id.toString(),
          passengerName: name,
          passengerCount: room.passengers.length,
          maxPassengers: room.maxPassengers,
          message: `${name} joined your carpool room`,
        });
      }
    }

    if (global.io) {
      global.io.emit("carpoolUserJoined", {
        roomId: room._id,
        participantCount: room.passengers.length,
        userName: name,
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Joined room successfully", room });
  } catch (error) {
    console.error("❌ Join room error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error joining room",
        error: error.message,
      });
  }
};

// ================= CHECK IN =================
const checkIn = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    await room.checkInPassenger(userId);

    const checkedInCount = room.getCheckedInCount();

    console.log(
      `✅ User checked in to room ${roomId} | ${checkedInCount}/${room.passengers.length}`,
    );

    // Notify driver of the check-in
    if (room.driverId) {
      const driverSocketId = global.driverSockets?.get(
        room.driverId.toString(),
      );
      if (driverSocketId && global.io) {
        const passenger = room.passengers.find(
          (p) => p.userId.toString() === userId.toString(),
        );
        global.io.to(driverSocketId).emit("carpoolPassengerCheckedIn", {
          roomId: room._id.toString(),
          passengerName: passenger?.name || "A passenger",
          checkedInCount,
          totalPassengers: room.passengers.length,
          message: `${passenger?.name || "A passenger"} has checked in`,
        });
      }
    }

    if (global.io) {
      global.io.emit("carpoolUserCheckedIn", {
        roomId: room._id,
        checkedInCount,
        totalPassengers: room.passengers.length,
      });
    }

    return res
      .status(200)
      .json({
        success: true,
        message: "Checked in successfully",
        room,
        checkedInCount,
      });
  } catch (error) {
    console.error("❌ Check in error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error checking in",
        error: error.message,
      });
  }
};

// ================= LEAVE ROOM =================
const leaveRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    const passenger = room.passengers.find(
      (p) => p.userId.toString() === userId.toString(),
    );
    const passengerName = passenger?.name;

    await room.removePassenger(userId);

    console.log(
      `✅ User left room ${roomId} | Remaining: ${room.passengers.length}`,
    );

    // Notify driver
    if (room.driverId && passengerName) {
      const driverSocketId = global.driverSockets?.get(
        room.driverId.toString(),
      );
      if (driverSocketId && global.io) {
        global.io.to(driverSocketId).emit("carpoolPassengerLeft", {
          roomId: room._id.toString(),
          passengerName,
          remainingCount: room.passengers.length,
          message: `${passengerName} has left the carpool`,
        });
      }
    }

    if (global.io) {
      global.io.emit("carpoolUserLeft", {
        roomId: room._id,
        participantCount: room.passengers.length,
      });
    }

    return res
      .status(200)
      .json({
        success: true,
        message: "Left room successfully",
        remainingPassengers: room.passengers.length,
      });
  } catch (error) {
    console.error("❌ Leave room error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error leaving room",
        error: error.message,
      });
  }
};

// ================= REMOVE PASSENGER =================
const removePassenger = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { passengerId } = req.body;
    const driverId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only driver can remove passengers" });
    }

    const passenger = room.passengers.find(
      (p) => p.userId.toString() === passengerId.toString(),
    );
    if (!passenger)
      return res
        .status(404)
        .json({ success: false, message: "Passenger not found" });

    const passengerName = passenger.name;
    await room.removePassenger(passengerId);

    // Notify the removed passenger
    const riderSocketId = global.riderSockets?.get(passengerId.toString());
    if (riderSocketId && global.io) {
      global.io.to(riderSocketId).emit("removedFromCarpoolRoom", {
        roomId: room._id.toString(),
        message: "You have been removed from the carpool room by the driver",
      });
    }

    if (global.io) {
      global.io.emit("carpoolPassengerRemoved", {
        roomId: room._id,
        passengerName,
        remainingCount: room.passengers.length,
      });
    }

    console.log(`❌ ${passengerName} removed from room ${roomId}`);
    return res
      .status(200)
      .json({
        success: true,
        message: `${passengerName} removed from room`,
        remainingPassengers: room.passengers.length,
      });
  } catch (error) {
    console.error("❌ Remove passenger error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error removing passenger",
        error: error.message,
      });
  }
};

// ================= START RIDE (REST fallback) =================
const startRide = async (req, res) => {
  try {
    const { roomId } = req.params;
    const driverId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only driver can start ride" });
    }

    // Atomically claim the status transition first — a concurrent second
    // start-ride call (or the socket equivalent) will find status is no
    // longer "assigned" and bail before ever touching the passenger list,
    // instead of both racing to overwrite the same loaded document via .save().
    const claimed = await CarpoolRoom.findOneAndUpdate(
      { _id: roomId, status: "assigned" },
      { status: "in_progress" },
      { new: false },
    );
    if (!claimed) {
      return res.status(409).json({
        success: false,
        message: `Room is not in "assigned" status`,
      });
    }

    const notCheckedIn = await room.startRide();

    console.log(
      `🚗 Ride started: ${roomId} | Active: ${room.passengers.length} | No-shows: ${notCheckedIn.length}`,
    );

    if (global.io) {
      global.io.emit("carpoolRideStarted", {
        roomId: room._id,
        activePassengers: room.passengers.length,
        removedPassengers: notCheckedIn.length,
      });

      room.passengers?.forEach((p) => {
        const riderSocketId = global.riderSockets?.get(p.userId?.toString());
        if (riderSocketId) {
          global.io.to(riderSocketId).emit("carpoolRideStarted", {
            roomId: room._id.toString(),
            message: "Your carpool ride has started!",
          });
        }
      });
    }

    return res
      .status(200)
      .json({
        success: true,
        message: "Ride started successfully",
        room,
        removedPassengers: notCheckedIn.length,
        activePassengers: room.passengers.length,
      });
  } catch (error) {
    console.error("❌ Start ride error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error starting ride",
        error: error.message,
      });
  }
};

// ================= COMPLETE RIDE (REST fallback) =================
const completeRide = async (req, res) => {
  try {
    const { roomId } = req.params;
    const driverId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);
    if (!room)
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res
        .status(403)
        .json({ success: false, message: "Only driver can complete ride" });
    }

    // Same atomic-claim pattern as startRide — prevents two concurrent
    // complete-ride calls (or a race with the socket equivalent) from both
    // proceeding.
    const claimed = await CarpoolRoom.findOneAndUpdate(
      { _id: roomId, status: "in_progress" },
      { status: "completed" },
      { new: false },
    );
    if (!claimed) {
      return res.status(409).json({
        success: false,
        message: `Room is not in "in_progress" status`,
      });
    }

    await room.completeRide();

    console.log(
      `✅ Ride completed: ${roomId} | Passengers: ${room.passengers.length}`,
    );

    if (global.io) {
      global.io.emit("carpoolRideCompleted", {
        roomId: room._id,
        passengersCount: room.passengers.length,
      });

      room.passengers?.forEach((p) => {
        const riderSocketId = global.riderSockets?.get(p.userId?.toString());
        if (riderSocketId) {
          global.io.to(riderSocketId).emit("carpoolRideCompleted", {
            roomId: room._id.toString(),
            message: "You've arrived! Thanks for carpooling with Drop.",
          });
        }
      });
    }

    return res
      .status(200)
      .json({ success: true, message: "Ride completed successfully", room });
  } catch (error) {
    console.error("❌ Complete ride error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error completing ride",
        error: error.message,
      });
  }
};

// ================= GET MY SESSION =================
const getMySession = async (req, res) => {
  try {
    const userId = req.user._id;

    const room = await CarpoolRoom.findOne({
      "passengers.userId": userId,
      status: { $in: ["waiting", "assigned", "in_progress"] },
    }).populate("driverId", "fullname carModel carColor plateNo");

    return res.status(200).json({
      success: true,
      message: room ? "Session fetched successfully" : "No active session",
      room: room || null,
    });
  } catch (error) {
    console.error("❌ Get session error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching session",
        error: error.message,
      });
  }
};

// ================= GET DRIVER'S ASSIGNED ROOMS =================
const getDriverRooms = async (req, res) => {
  try {
    const driverId = req.user._id;

    const rooms = await CarpoolRoom.find({
      driverId,
      status: { $in: ["assigned", "in_progress", "waiting"] },
    }).sort({ departureTime: 1 });

    return res.status(200).json({ success: true, rooms, count: rooms.length });
  } catch (error) {
    console.error("❌ Get driver rooms error:", error.message);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// ================= NEARBY ROOMS =================
const getNearbyRooms = async (req, res) => {
  try {
    const { latitude, longitude, radiusKm } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "Latitude and longitude required" });
    }

    const maxRadius = radiusKm || 10;

    const allRooms = await CarpoolRoom.find({
      status: { $in: ["waiting", "assigned"] },
      departureTime: { $gte: new Date() },
    })
      .populate("driverId", "fullname carModel carColor plateNo")
      .lean();

    const nearbyRooms = allRooms
      .filter((room) => {
        if (!room.pickupCoordinates) return false;
        const dist = getDistanceKm(
          latitude,
          longitude,
          room.pickupCoordinates.latitude,
          room.pickupCoordinates.longitude,
        );
        room.distanceFromUser = Number(dist.toFixed(2));
        return dist <= maxRadius;
      })
      .sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    console.log(
      `📍 Found ${nearbyRooms.length} nearby rooms within ${maxRadius}km`,
    );

    return res
      .status(200)
      .json({
        success: true,
        message: "Nearby rooms fetched successfully",
        rooms: nearbyRooms,
        count: nearbyRooms.length,
        radiusKm: maxRadius,
      });
  } catch (error) {
    console.error("❌ Get nearby rooms error:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message: "Server error fetching nearby rooms",
        error: error.message,
      });
  }
};

module.exports = {
  createRoom,
  getAllRooms,
  getRoom,
  cancelRoom,
  joinRoom,
  checkIn,
  leaveRoom,
  removePassenger,
  startRide,
  completeRide,
  getMySession,
  getNearbyRooms,
  assignDriver,
  retryDriverSearch,
  getDriverRooms,
};
