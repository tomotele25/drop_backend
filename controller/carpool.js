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
      return res.status(400).json({
        success: false,
        message: "Pickup, destination, and departure time are required",
      });
    }

    if (!price) {
      return res.status(400).json({
        success: false,
        message: "Price is required",
      });
    }

    // Validate price range
    if (price < 100 || price > 50000) {
      return res.status(400).json({
        success: false,
        message: "Price must be between ₦100 and ₦50,000",
      });
    }

    // Validate departure time is in future
    const departureDate = new Date(departureTime);
    if (departureDate < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Departure time must be in the future",
      });
    }

    // GEOCODE PICKUP
    const pickupGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: pickup,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );

    if (pickupGeo.data.status !== "OK") {
      return res.status(400).json({
        success: false,
        message: "Invalid pickup address",
      });
    }

    const pickupLoc = pickupGeo.data.results[0].geometry.location;

    // GEOCODE DESTINATION
    const destinationGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: destination,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );

    if (destinationGeo.data.status !== "OK") {
      return res.status(400).json({
        success: false,
        message: "Invalid destination address",
      });
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
      return res.status(400).json({
        success: false,
        message: "Unable to calculate route",
      });
    }

    const leg = directionsRes.data.routes[0].legs[0];
    const distance = Number((leg.distance.value / 1000).toFixed(2));
    const duration = Math.ceil(leg.duration.value / 60);

    // GET DRIVER DETAILS (if available)
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
      } catch (err) {
        console.log("Driver not found, using defaults");
      }
    }

    // CREATE ROOM - with rideType support
    const room = await CarpoolRoom.create({
      route: `${pickup} → ${destination}`,
      pickup,
      destination,
      pickupCoordinates: {
        latitude: pickupLoc.lat,
        longitude: pickupLoc.lng,
      },
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

    console.log(`✅ Carpool room created: ${room._id}`);
    console.log(`   Route: ${room.route}`);
    console.log(`   Price: ₦${room.price}`);
    console.log(`   Type: ${room.rideType}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("newCarpoolRoom", {
        roomId: room._id,
        route: room.route,
        pickup: room.pickup,
        destination: room.destination,
        price: room.price,
        rideType: room.rideType,
      });
    }

    return res.status(201).json({
      success: true,
      message: "✅ Carpool room created successfully",
      room,
    });
  } catch (error) {
    console.error("❌ Create room error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error creating room",
      error: error.message,
    });
  }
};

// ================= GET ALL ROOMS (with status filter) =================
const getAllRooms = async (req, res) => {
  try {
    const { status } = req.query;

    // Build query
    const query = {
      departureTime: { $gte: new Date() },
    };

    // Add status filter if provided
    if (status && status !== "all") {
      query.status = status;
    } else {
      // Default to waiting if no filter
      query.status = "waiting";
    }

    const rooms = await CarpoolRoom.find(query)
      .populate("driverId", "fullname carModel carColor plateNo")
      .sort({ departureTime: 1 })
      .lean();

    console.log(
      `📋 Fetched ${rooms.length} rooms (status: ${status || "waiting"})`,
    );

    return res.status(200).json({
      success: true,
      message: "Carpool rooms fetched successfully",
      rooms,
      count: rooms.length,
    });
  } catch (error) {
    console.error("❌ Get rooms error:", error.message);
    return res.status(500).json({
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

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    console.log(`📍 Room fetched: ${room._id}`);

    return res.status(200).json({
      success: true,
      message: "Room fetched successfully",
      room,
    });
  } catch (error) {
    console.error("❌ Get room error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching room",
      error: error.message,
    });
  }
};

// ================= DELETE ROOM =================
const deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user?._id;

    const room = await CarpoolRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    // Check if user is driver or admin (if driverId is null, anyone can delete)
    if (room.driverId && userId) {
      if (room.driverId.toString() !== userId.toString()) {
        return res.status(403).json({
          success: false,
          message: "Only the driver can delete this room",
        });
      }
    }

    await CarpoolRoom.findByIdAndDelete(roomId);

    console.log(`🗑️ Room deleted: ${roomId}`);
    console.log(`   Route: ${room.route}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolRoomDeleted", {
        roomId: room._id,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete room error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error deleting room",
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

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Passenger name is required",
      });
    }

    const room = await CarpoolRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.isFull()) {
      return res.status(400).json({
        success: false,
        message: "Room is full",
      });
    }

    if (
      room.passengers.some((p) => p.userId.toString() === userId.toString())
    ) {
      return res.status(400).json({
        success: false,
        message: "You are already in this room",
      });
    }

    await room.addPassenger(userId, name, phone);

    console.log(`✅ ${name} joined room ${roomId}`);
    console.log(
      `   Participants: ${room.passengers.length}/${room.maxPassengers}`,
    );

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolUserJoined", {
        roomId: room._id,
        participantCount: room.passengers.length,
        userName: name,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Joined room successfully",
      room,
    });
  } catch (error) {
    console.error("❌ Join room error:", error.message);
    return res.status(500).json({
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

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    await room.checkInPassenger(userId);

    const checkedInCount = room.getCheckedInCount();

    console.log(`✅ User checked in to room ${roomId}`);
    console.log(`   Checked in: ${checkedInCount}/${room.passengers.length}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolUserCheckedIn", {
        roomId: room._id,
        checkedInCount,
        totalPassengers: room.passengers.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Checked in successfully",
      room,
      checkedInCount,
    });
  } catch (error) {
    console.error("❌ Check in error:", error.message);
    return res.status(500).json({
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

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    await room.removePassenger(userId);

    console.log(`✅ User left room ${roomId}`);
    console.log(`   Remaining: ${room.passengers.length}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolUserLeft", {
        roomId: room._id,
        participantCount: room.passengers.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Left room successfully",
      remainingPassengers: room.passengers.length,
    });
  } catch (error) {
    console.error("❌ Leave room error:", error.message);
    return res.status(500).json({
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

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only driver can remove passengers",
      });
    }

    const passenger = room.passengers.find(
      (p) => p.userId.toString() === passengerId.toString(),
    );

    if (!passenger) {
      return res.status(404).json({
        success: false,
        message: "Passenger not found",
      });
    }

    const passengerName = passenger.name;
    await room.removePassenger(passengerId);

    console.log(`❌ ${passengerName} removed from room ${roomId}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolPassengerRemoved", {
        roomId: room._id,
        passengerName,
        remainingCount: room.passengers.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: `${passengerName} removed from room`,
      remainingPassengers: room.passengers.length,
    });
  } catch (error) {
    console.error("❌ Remove passenger error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error removing passenger",
      error: error.message,
    });
  }
};

// ================= START RIDE =================
const startRide = async (req, res) => {
  try {
    const { roomId } = req.params;
    const driverId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only driver can start ride",
      });
    }

    const notCheckedIn = await room.startRide();

    console.log(`🚗 Ride started: ${roomId}`);
    console.log(`   Active: ${room.passengers.length}`);
    console.log(`   No-shows: ${notCheckedIn.length}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolRideStarted", {
        roomId: room._id,
        activePassengers: room.passengers.length,
        removedPassengers: notCheckedIn.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ride started successfully",
      room,
      removedPassengers: notCheckedIn.length,
      activePassengers: room.passengers.length,
    });
  } catch (error) {
    console.error("❌ Start ride error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error starting ride",
      error: error.message,
    });
  }
};

// ================= COMPLETE RIDE =================
const completeRide = async (req, res) => {
  try {
    const { roomId } = req.params;
    const driverId = req.user._id;

    const room = await CarpoolRoom.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.driverId && room.driverId.toString() !== driverId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Only driver can complete ride",
      });
    }

    await room.completeRide();

    console.log(`✅ Ride completed: ${roomId}`);
    console.log(`   Passengers delivered: ${room.passengers.length}`);

    // BROADCAST
    if (global.io) {
      global.io.emit("carpoolRideCompleted", {
        roomId: room._id,
        passengersCount: room.passengers.length,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ride completed successfully",
      room,
    });
  } catch (error) {
    console.error("❌ Complete ride error:", error.message);
    return res.status(500).json({
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
    }).populate("driverId", "fullname carModel");

    if (!room) {
      return res.status(200).json({
        success: true,
        message: "No active session",
        room: null,
      });
    }

    console.log(`📍 Session fetched for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: "Session fetched successfully",
      room,
    });
  } catch (error) {
    console.error("❌ Get session error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error fetching session",
      error: error.message,
    });
  }
};

// ================= GET NEARBY ROOMS (FIXED - with actual distance filtering) =================
const getNearbyRooms = async (req, res) => {
  try {
    const { latitude, longitude, radiusKm } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude required",
      });
    }

    const maxRadius = radiusKm || 10; // Default 10km radius

    const allRooms = await CarpoolRoom.find({
      status: "waiting",
      departureTime: { $gte: new Date() },
    })
      .populate("driverId", "fullname carModel carColor plateNo")
      .lean();

    // Filter rooms by distance from user's location
    const nearbyRooms = allRooms.filter((room) => {
      if (!room.pickupCoordinates) return false;

      const distance = getDistanceKm(
        latitude,
        longitude,
        room.pickupCoordinates.latitude,
        room.pickupCoordinates.longitude,
      );

      // Add distance to room object
      room.distanceFromUser = Number(distance.toFixed(2));

      return distance <= maxRadius;
    });

    // Sort by distance
    nearbyRooms.sort((a, b) => a.distanceFromUser - b.distanceFromUser);

    console.log(
      `📍 Found ${nearbyRooms.length} nearby rooms within ${maxRadius}km`,
    );

    return res.status(200).json({
      success: true,
      message: "Nearby rooms fetched successfully",
      rooms: nearbyRooms,
      count: nearbyRooms.length,
      radiusKm: maxRadius,
    });
  } catch (error) {
    console.error("❌ Get nearby rooms error:", error.message);
    return res.status(500).json({
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
  deleteRoom,
  joinRoom,
  checkIn,
  leaveRoom,
  removePassenger,
  startRide,
  completeRide,
  getMySession,
  getNearbyRooms,
};
