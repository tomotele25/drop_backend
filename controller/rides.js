const { config } = require("dotenv");
const Ride = require("../model/ride");
const Rider = require("../model/rider");
const Room = require("../model/room");
const axios = require("axios");

const TOTAL_SEATS = 6;
const BASE_FARES = {
  standard: 500,
  premium: 1000,
};

const PER_MINUTE = 22;
const PER_KM = 149;

const normalizeAddress = (addr) =>
  addr
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

const bookRide = async (req, res) => {
  try {
    let { pickup, destination, rideType, passengerName } = req.body;

    // Validate inputs
    if (!pickup || !destination || !rideType || !passengerName) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (!["standard", "premium"].includes(rideType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ride type",
      });
    }

    pickup = normalizeAddress(pickup);
    destination = normalizeAddress(destination);

    const directionsURL = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
      pickup
    )}&destination=${encodeURIComponent(destination)}&key=${
      process.env.GOOGLE_MAPS_API_KEY
    }`;

    const mapRes = await axios.get(directionsURL);

    if (mapRes.data.status !== "OK") {
      return res.status(400).json({
        success: false,
        message: "Invalid route. Please check pickup and destination.",
        details: mapRes.data,
      });
    }

    const leg = mapRes.data.routes[0].legs[0];
    const distanceKm = leg.distance.value / 1000;
    const durationMin = leg.duration.value / 60;

    if (distanceKm > 500) {
      return res.status(400).json({
        success: false,
        message:
          "Route is too long. Please select locations within reasonable driving distance.",
      });
    }

    const baseFare = BASE_FARES[rideType];
    let totalFare = baseFare + distanceKm * PER_KM + durationMin * PER_MINUTE;

    // Minimum fares
    if (rideType === "standard") totalFare = Math.max(totalFare, 1500);
    if (rideType === "premium") totalFare = Math.max(totalFare, 2500);

    const pickupEta =
      rideType === "premium"
        ? Math.floor(Math.random() * 3) + 2
        : Math.floor(Math.random() * 4) + 5;

    const driverId = null;

    const newRide = new Ride({
      driver: driverId,
      pickup,
      destination,
      passengerName,
      rideType,
      status: "requested",
      fare: Math.floor(totalFare),
      basePrice: baseFare,
      distance: distanceKm,
      duration: durationMin,
      pickupEta,
    });

    const savedRide = await newRide.save();

    return res.status(200).json({
      success: true,
      message: "Ride booked successfully",
      ride: savedRide,
    });
  } catch (error) {
    console.error("Error booking ride:", error);
    return res.status(500).json({
      success: false,
      message: "Server error booking ride",
      error: error.message,
    });
  }
};
const getAutocompleteSuggestions = async (req, res) => {
  try {
    const { input } = req.body;
    console.log(input);

    if (!input) {
      return res.status(400).json({ success: false, message: "Missing input" });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input,
          key: apiKey,
          types: "geocode",
          components: "country:ng",
          location: "9.0820,8.6753",
          radius: 1000000,
          sessiontoken: Date.now(),
        },
      }
    );

    const predictions = response.data.predictions.map((p) => ({
      description: p.description,
      place_id: p.place_id,
    }));

    res.status(200).json({ success: true, predictions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getRouteAndRides = async (req, res) => {
  try {
    const { pickup, destination } = req.body;

    if (!pickup || !destination) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/directions/json",
      {
        params: {
          origin: pickup,
          destination: destination,
          mode: "driving",
          key: apiKey,
        },
      }
    );

    if (response.data.status !== "OK") {
      return res.status(400).json({
        success: false,
        message: "Google Error: " + response.data.status,
      });
    }

    const route = response.data.routes[0].legs[0];

    const distanceMeters = route.distance.value;
    const durationSeconds = route.duration.value;

    const distanceKm = distanceMeters / 1000;
    const durationMinutes = durationSeconds / 60;

    const BASE_FARES = {
      standard: 500,
      premium: 1000,
    };

    const PER_KM = 149;
    const PER_MINUTE = 22;

    const calculateFare = (type) => {
      const base = BASE_FARES[type];
      const fare = base + distanceKm * PER_KM + durationMinutes * PER_MINUTE;
      return Math.round(fare);
    };

    const fares = {
      standard: calculateFare("standard"),
      premium: calculateFare("premium"),
    };

    return res.json({
      success: true,
      distance: route.distance.text,
      duration: route.duration.text,
      distanceKm,
      durationMinutes,
      fares,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Fetch available riders
const getAvailableRider = async (req, res) => {
  try {
    const availableRiders = await Rider.find({ isActive: true }).select(
      "fullname plateNo isActive carModel carColor currentLocation"
    );

    return res.status(200).json({
      success: true,
      message: "Riders fetched successfully",
      availableRiders,
    });
  } catch (error) {
    console.error("Error fetching riders:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching riders",
      error: error.message,
    });
  }
};

const createRide = async (req, res) => {
  try {
    const {
      driverId,
      pickup,
      destination,
      rideType,
      basePrice,
      creatorId,
      creatorName,
    } = req.body;

    if (!pickup || !destination || !rideType || !basePrice) {
      return res.status(400).json({
        success: false,
        message: "Pickup, destination, ride type, and base price are required",
      });
    }

    // Standard or Premium Ride (driver required)
    if (rideType === "standard" || rideType === "premium") {
      if (!driverId) {
        return res.status(400).json({
          success: false,
          message: "Driver is required for standard/premium rides",
        });
      }

      const newRide = new Ride({
        driver: driverId,
        pickup,
        destination,
        rideType,
        basePrice,
        seats: TOTAL_SEATS,
        passengers: creatorName
          ? [{ id: creatorId || null, name: creatorName, seats: 1 }]
          : [], // only add passenger if name provided
        status: "available",
      });

      const savedRide = await newRide.save();

      return res.status(200).json({
        success: true,
        message: "Ride created successfully",
        ride: savedRide,
      });
    }

    // Shared Ride (driver not required)
    if (rideType === "shared") {
      const passengers = [];

      // Add creator if they provided a name (optional)
      if (creatorName) {
        passengers.push({
          id: creatorId || null,
          name: creatorName,
          seats: 1,
        });
      }

      const newRoom = new Room({
        creatorId: creatorId || null,
        creatorName: creatorName || "Guest",
        driverId: null,
        pickupLocation: pickup,
        destination,
        seats: TOTAL_SEATS,
        passengers,
        rideType: "shared",
        basePrice,
        status: "available",
      });

      const savedRoom = await newRoom.save();

      return res.status(200).json({
        success: true,
        message: "Carpool room created successfully",
        room: savedRoom,
      });
    }

    // Invalid type
    return res.status(400).json({
      success: false,
      message: "Invalid ride type. Must be 'standard', 'premium', or 'shared'.",
    });
  } catch (error) {
    console.error("Error creating ride:", error);
    return res.status(500).json({
      success: false,
      message: "Server error creating ride",
      error: error.message,
    });
  }
};

const joinRide = async (req, res) => {
  try {
    const { roomId, passengerName, passengerId, seats } = req.body;

    // roomId and seats must always be provided, name/id are optional
    if (!roomId || !seats) {
      return res.status(400).json({
        success: false,
        message: "roomId and number of seats are required",
      });
    }

    // generate a name for guest if none provided
    const nameToUse =
      passengerName || `Guest-${Math.floor(Math.random() * 10000)}`;
    const idToUse = passengerId || null; // guest has no user id

    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: "Room not found",
      });
    }

    if (room.status !== "available") {
      return res.status(400).json({
        success: false,
        message: "Room is no longer available",
      });
    }

    if (!room.passengers) room.passengers = [];

    // prevent duplicate joins (only check id if user logged in)
    const alreadyJoined = room.passengers.some(
      (p) => (idToUse && p.id === idToUse) || p.name === nameToUse
    );

    if (alreadyJoined) {
      return res.status(400).json({
        success: false,
        message: "Passenger already joined this room",
      });
    }

    // check seat availability
    const seatsTaken = room.passengers.reduce((acc, p) => acc + p.seats, 0);
    const seatsLeft = room.seats - seatsTaken;

    if (seats > seatsLeft) {
      return res.status(400).json({
        success: false,
        message: `Not enough seats left. Only ${seatsLeft} remaining`,
      });
    }

    room.passengers.push({
      id: idToUse,
      name: nameToUse,
      seats,
    });

    const totalSeatsTaken = room.passengers.reduce(
      (acc, p) => acc + p.seats,
      0
    );
    if (totalSeatsTaken >= room.seats) {
      room.status = "full";
    }

    await room.save();

    return res.status(200).json({
      success: true,
      message: "Joined room successfully",
      room,
    });
  } catch (error) {
    console.error("Error joining room:", error);
    return res.status(500).json({
      success: false,
      message: "Server error joining room",
      error: error.message,
    });
  }
};

// Fetch available rooms
const getAvailableRooms = async (req, res) => {
  try {
    const rooms = await Room.find({
      status: "available",
      $expr: { $lt: [{ $size: "$passengers" }, "$seats"] },
    }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      rooms,
      message: rooms.length ? "Available rooms fetched" : "No available rooms",
    });
  } catch (error) {
    console.error("Error fetching rooms:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching available rooms",
      error: error.message,
    });
  }
};

// Get a room by ID
const getRoomById = async (req, res) => {
  try {
    const { id } = req.params;
    const room = await Room.findById(id);
    if (!room) {
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });
    }
    return res.status(200).json({ success: true, room });
  } catch (error) {
    console.error("Error fetching room:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching room",
      error: error.message,
    });
  }
};

module.exports = {
  bookRide,
  joinRide,
  getAvailableRider,
  createRide,
  getAvailableRooms,
  getAutocompleteSuggestions,
  getRoomById,
  getRouteAndRides,
};
