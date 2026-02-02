require("dotenv").config();

const Ride = require("../model/ride");
const Rider = require("../model/rider");
const axios = require("axios");


const axios = require("axios");
const Ride = require("../models/Ride");
const Rider = require("../models/Rider");

/* ----------------------------------
   Helper: find nearest driver
---------------------------------- */
const findNearestDriver = async (pickupLoc, busyDriverIds) => {
  const radii = [5000, 10000, 15000]; // meters

  for (const radius of radii) {
    const driver = await Rider.findOne({
      isActive: true,
      _id: { $nin: busyDriverIds },
      currentLocation: {
        $near: {
          $geometry: {
            type: "Point",
            coordinates: [pickupLoc.lng, pickupLoc.lat],
          },
          $maxDistance: radius,
        },
      },
    });

    if (driver) {
      return { driver, radius };
    }
  }

  return null;
};

const bookRide = async (req, res) => {
  try {
    const { pickup, destination, rideType, passengerName } = req.body;

    if (!pickup || !destination || !rideType) {
      return res.status(400).json({
        success: false,
        message: "Pickup, destination and ride type are required",
      });
    }

    /* ----------------------------------
       1️⃣ GEOCODE PICKUP
    ---------------------------------- */
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

    /* ----------------------------------
       2️⃣ GEOCODE DESTINATION
    ---------------------------------- */
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

    /* ----------------------------------
       3️⃣ DIRECTIONS API (REAL ETA)
    ---------------------------------- */
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

    const distance = Number((leg.distance.value / 1000).toFixed(2)); // km
    const duration = Math.ceil(leg.duration.value / 60); // minutes

    /* ----------------------------------
       4️⃣ BASE PRICE CALCULATION
    ---------------------------------- */
    const BASE_FARE = 500; // ₦
    const PRICE_PER_KM = 120;
    const PRICE_PER_MIN = 20;

    const basePrice =
      BASE_FARE + distance * PRICE_PER_KM + duration * PRICE_PER_MIN;

    /* ----------------------------------
       5️⃣ BUSY DRIVERS
    ---------------------------------- */
    const busyDriverIds = await Ride.find({
      status: { $in: ["assigned", "ongoing"] },
    }).distinct("driver");

    /* ----------------------------------
       6️⃣ FIND DRIVER (5km → 10km → 15km)
    ---------------------------------- */
    const result = await findNearestDriver(pickupLoc, busyDriverIds);

    if (!result) {
      return res.status(400).json({
        success: false,
        message: "No drivers available nearby",
      });
    }

    const { driver, radius } = result;

    /* ----------------------------------
       7️⃣ CREATE RIDE (MODEL UNCHANGED)
    ---------------------------------- */
    const ride = await Ride.create({
      driver: driver._id,
      pickup,
      destination,
      distance, // Number
      duration, // Number
      pickupCoordinates: pickupLoc,
      destinationCoordinates: destinationLoc,
      rideType,
      passengerName,
      basePrice,
      status: "requested",
    });

    /* ----------------------------------
       8️⃣ SOCKET NOTIFICATION
    ---------------------------------- */
    const socketId = global.driverSockets?.get(driver._id.toString());

    if (socketId) {
      global.io.to(socketId).emit("rideAssigned", {
        rideId: ride._id,
        pickup,
        destination,
        distance: `${distance} km`,
        duration: `${duration} mins`,
        basePrice,
        passengerName,
        searchRadiusKm: radius / 1000,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ride booked successfully",
      ride,
    });
  } catch (error) {
    console.error("Ride booking error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error booking ride",
      error: error.message,
    });
  }
};

// ================= AUTOCOMPLETE =================
const getAutocompleteSuggestions = async (req, res) => {
  try {
    const { input, locationContext } = req.body;
    if (!input) {
      return res.status(400).json({ success: false, message: "Missing input" });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    let locationBias = null;
    if (locationContext) {
      const geoRes = await axios.get(
        "https://maps.googleapis.com/maps/api/geocode/json",
        {
          params: { address: locationContext, key: apiKey },
        },
      );

      if (geoRes.data.results.length > 0) {
        const { lat, lng } = geoRes.data.results[0].geometry.location;
        locationBias = `${lat},${lng}`;
      }
    }

    const autoRes = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input: locationContext ? `${input}, ${locationContext}` : input,
          key: apiKey,
          components: "country:ng",
          types: "geocode",
          location: locationBias || "9.0820,8.6753",
          radius: 50000,
        },
      },
    );

    const results = autoRes.data.predictions.map((p) => ({
      description: p.description,
      place_id: p.place_id,
      source: "autocomplete",
    }));

    if (results.length > 0) {
      return res.status(200).json({ success: true, predictions: results });
    }

    const textSearchRes = await axios.get(
      "https://maps.googleapis.com/maps/api/place/textsearch/json",
      {
        params: {
          query: locationContext ? `${input}, ${locationContext}` : input,
          key: apiKey,
        },
      },
    );

    const combined = textSearchRes.data.results.map((p) => ({
      description: p.name,
      place_id: p.place_id,
      source: "textsearch",
    }));

    return res.status(200).json({ success: true, predictions: combined });
  } catch (err) {
    console.error("Autocomplete Error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= ROUTE + FARES =================
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
        params: { origin: pickup, destination, mode: "driving", key: apiKey },
      },
    );

    if (response.data.status !== "OK") {
      return res
        .status(400)
        .json({ success: false, message: response.data.status });
    }

    const route = response.data.routes[0].legs[0];

    const distanceKm = route.distance.value / 1000;
    const durationMinutes = route.duration.value / 60;

    const BASE_FARES = { standard: 500, premium: 1000 };
    const PER_KM = 149;
    const PER_MINUTE = 22;

    const calculateFare = (type) =>
      Math.ceil(
        (BASE_FARES[type] +
          distanceKm * PER_KM +
          durationMinutes * PER_MINUTE) /
          50,
      ) * 50;

    return res.json({
      success: true,
      distance: route.distance.text,
      duration: route.duration.text,
      distanceKm,
      durationMinutes,
      fares: {
        standard: calculateFare("standard"),
        premium: calculateFare("premium"),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= RIDERS =================
const getAvailableRider = async (req, res) => {
  try {
    const availableRiders = await Rider.find({ isActive: true }).select(
      "fullname plateNo carModel carColor currentLocation",
    );

    res.status(200).json({
      success: true,
      message: "Riders fetched successfully",
      availableRiders,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getRiderById = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id).select(
      "fullname carModel carColor plateNo currentLocation phoney",
    );

    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    res.status(200).json({ success: true, rider });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= RIDE BY ID =================
const getRideById = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id).populate("driver");

    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }

    res.status(200).json({
      success: true,
      ride,
      pickupCoords: ride.pickupCoordinates
        ? {
            lat: ride.pickupCoordinates.lat,
            lng: ride.pickupCoordinates.lng,
          }
        : null,
      destinationCoords: ride.destinationCoordinates
        ? {
            lat: ride.destinationCoordinates.lat,
            lng: ride.destinationCoordinates.lng,
          }
        : null,
    });
  } catch (error) {
    console.error("Get ride error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};


module.exports = {
  bookRide,
  getAutocompleteSuggestions,
  getRouteAndRides,
  getAvailableRider,
  getRiderById,
  getRideById,
};
