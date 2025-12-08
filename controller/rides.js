const { config } = require("dotenv");
const Ride = require("../model/ride");
const Rider = require("../model/rider");
const Room = require("../model/room");
const axios = require("axios");

const TOTAL_SEATS = 6;

const hardcodedRiders = [
  {
    _id: "68f02dfc688c8a83133b72fd",
    fullname: "David Awosanya",
    carModel: "Lexus ES350",
    carColor: "Blue",
    plateNo: "456FgyW",
    isAvailable: true,
    location: { type: "Point", coordinates: [3.4363, 7.2244] }, // [lng, lat]
  },
];

// Utility to calculate distance in meters between two coordinates
function getDistance(lat1, lng1, lat2, lng2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371e3; // Earth radius in meters
  const φ1 = toRad(lat1),
    φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1),
    Δλ = toRad(lng2 - lng1);

  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // meters
}

const bookRide = async (req, res) => {
  try {
    const {
      pickup,
      destination,
      rideType,
      passengerName,
      fare,
      distance,
      duration,
    } = req.body;

    if (
      !pickup ||
      !destination ||
      !rideType ||
      !passengerName ||
      !fare ||
      !distance ||
      !duration
    ) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    if (!["standard", "premium"].includes(rideType.toLowerCase())) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ride type" });
    }

    // --- Convert pickup address to coordinates ---
    const geocodeURL = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      pickup
    )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

    const geoRes = await axios.get(geocodeURL);
    if (!geoRes.data.results.length)
      throw new Error("Unable to geocode pickup address");

    const [pickupLat, pickupLng] = [
      geoRes.data.results[0].geometry.location.lat,
      geoRes.data.results[0].geometry.location.lng,
    ];

    // --- Find nearby drivers with dynamic radius ---
    let radius = 5000; // 5 km
    let nearbyDrivers = [];
    while (radius <= 20000 && nearbyDrivers.length === 0) {
      nearbyDrivers = hardcodedRiders.filter(
        (r) =>
          r.isAvailable &&
          getDistance(
            pickupLat,
            pickupLng,
            r.location.coordinates[1],
            r.location.coordinates[0]
          ) <= radius
      );
      radius += 5000; // expand by 5 km
    }

    const driver = nearbyDrivers.length > 0 ? nearbyDrivers[0] : null;
    const driverId = driver ? driver._id : null;

    // --- Create Ride ---
    const newRide = new Ride({
      driver: driverId,
      pickup,
      destination,
      passengerName,
      rideType,
      status: driverId ? "assigned" : "requested",
      fare: Number(fare),
      distance: Number(distance),
      duration: Number(duration),
      pickupCoordinates: { type: "Point", coordinates: [pickupLng, pickupLat] },
    });

    const savedRide = await newRide.save();

    return res.status(200).json({
      success: true,
      message: driverId
        ? "Ride booked and driver assigned!"
        : "Ride booked, waiting for driver",
      ride: savedRide,
      assignedDriver: driver || null,
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
    const { input, locationContext } = req.body;

    if (!input) {
      return res.status(400).json({
        success: false,
        message: "Missing input",
      });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    let locationBias = null;
    if (locationContext) {
      const geoRes = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: {
            address: locationContext,
            key: apiKey,
          },
        }
      );

      if (geoRes.data.results.length > 0) {
        const { lat, lng } = geoRes.data.results[0].geometry.location;
        locationBias = `${lat},${lng}`;
      }
    }

    // 1️⃣ AUTOCOMPLETE REQUEST
    const autoRes = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input: locationContext ? `${input}, ${locationContext}` : input,
          key: apiKey,
          components: "country:ng",
          types: "geocode",
          location: locationBias || "9.0820,8.6753", // default Nigeria center
          radius: 50000, // 50 km
        },
      }
    );

    let results = autoRes.data.predictions.map((p) => ({
      description: p.description,
      place_id: p.place_id,
      source: "autocomplete",
    }));

    // If Autocomplete returned enough, return it
    if (results.length > 2) {
      return res.status(200).json({
        success: true,
        predictions: results,
      });
    }

    // 2️⃣ TEXT SEARCH (FALLBACK)
    const textSearchRes = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      {
        params: {
          query: locationContext ? `${input}, ${locationContext}` : input,
          key: apiKey,
        },
      }
    );

    const textResults = textSearchRes.data.results.map((p) => ({
      description: p.name,
      place_id: p.place_id,
      source: "textsearch",
    }));

    // MERGE BOTH (remove duplicates)
    const combined = [
      ...results,
      ...textResults.filter(
        (t) => !results.some((a) => a.place_id === t.place_id)
      ),
    ];

    return res.status(200).json({
      success: true,
      predictions: combined,
    });
  } catch (err) {
    console.error("Autocomplete Error:", err);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
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

const getRideById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Ride ID is required",
      });
    }

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "Ride not found",
      });
    }

    // 🔹 INLINE geocoding (no external function)
    const geocode = async (address) => {
      try {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
          address
        )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

        const response = await axios.get(url);

        if (response.data.status === "OK" && response.data.results.length > 0) {
          return response.data.results[0].geometry.location; // { lat, lng }
        }

        return null;
      } catch (err) {
        console.error("Geocode error:", err);
        return null;
      }
    };

    // 🌍 Convert pickup & destination to lat/lng
    const pickupCoords = await geocode(ride.pickup);
    const destinationCoords = await geocode(ride.destination);

    return res.status(200).json({
      success: true,
      message: "Ride found successfully",
      ride,
      pickupCoords,
      destinationCoords,
    });
  } catch (error) {
    console.error("Error fetching ride:", error);
    return res.status(500).json({
      success: false,
      message: "Error fetching ride",
    });
  }
};

const getRiderById = async (req, res) => {
  try {
    const { id } = req.params;

    const rider = await Rider.findById(id).select(
      "fullname carModel carColor plateNo currentLocation phone"
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Rider fetched successfully",
      rider,
    });
  } catch (error) {
    console.error("Error fetching rider:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching rider",
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
  getRiderById,
  getRouteAndRides,
  getRideById,
};
