require("dotenv").config();

const ride = require("../model/ride");
const Ride = require("../model/ride");
const Rider = require("../model/rider");
const axios = require("axios");



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

const normalize = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const findNearbyDrivers = (pickupLoc, drivers, radiusKm = 10) => {
  const nearbyDrivers = [];

  for (const driver of drivers) {
    const lat = normalize(driver.currentLocation?.latitude);
    const lng = normalize(driver.currentLocation?.longitude);

    if (lat === null || lng === null) continue;

    const dist = getDistanceKm(pickupLoc.lat, pickupLoc.lng, lat, lng);

    if (dist <= radiusKm) {
      nearbyDrivers.push({
        driver,
        distance: dist,
      });
    }
  }

  nearbyDrivers.sort((a, b) => a.distance - b.distance);
  return nearbyDrivers.map((d) => d.driver);
};

const bookRide = async (req, res) => {
  try {
    const { pickup, destination, rideType, passengers, fare } = req.body;

    if (!pickup || !destination || !rideType) {
      return res.status(400).json({
        success: false,
        message: "Pickup, destination and ride type are required",
      });
    }

    if (!Array.isArray(passengers) || passengers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one passenger is required",
      });
    }

    let basePrice = fare ? Number(fare) : 0;
    if (isNaN(basePrice)) basePrice = 0;

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

    // CALCULATE FARE
    if (basePrice === 0) {
      const BASE_FARES = { standard: 500, premium: 1000 };
      const PER_KM = 149;
      const PER_MINUTE = 22;

      const fareCalc =
        BASE_FARES[rideType.toLowerCase()] +
        distance * PER_KM +
        duration * PER_MINUTE;

      basePrice = Math.ceil(fareCalc / 50) * 50;
    }

    // FIND AVAILABLE DRIVERS
    const busyDriverIds = await Ride.find({
      status: { $in: ["ongoing", "accepted", "arrived"] },
    }).distinct("driver");

    const availableDrivers = await Rider.find({
      isActive: true,
      _id: { $nin: busyDriverIds },
    });

    if (!availableDrivers.length) {
      return res.status(400).json({
        success: false,
        message: "No drivers available nearby",
      });
    }

    // FIND NEARBY DRIVERS
    const nearbyDrivers = findNearbyDrivers(pickupLoc, availableDrivers, 10);

    if (!nearbyDrivers.length) {
      return res.status(400).json({
        success: false,
        message: "No drivers available within 10km of your location",
      });
    }

    // ✅ CREATE RIDE WITH NO DRIVER ASSIGNED
    const ride = await Ride.create({
      driver: null,
      pickup,
      destination,
      pickupCoordinates: pickupLoc,
      destinationCoordinates: destinationLoc,
      distance,
      duration,
      rideType,
      passengers,
      basePrice,
      status: "pending",
      requestedAt: new Date(),
      rejectedBy: [],
    });

    console.log(`📝 Ride created: ${ride._id}`);
    console.log(`   Driver: ${ride.driver || "null (NOT ASSIGNED) ✅"}`);
    console.log(`   Status: ${ride.status}`);

    // ✅ TRACK OFFER IN MEMORY
    const driverIds = nearbyDrivers.map((d) => d._id.toString());
    global.rideOffers = global.rideOffers || new Map();
    global.rideOffers.set(ride._id.toString(), {
      offeredAt: Date.now(),
      offeredTo: driverIds,
      acceptedBy: null,
    });

    // ✅ BROADCAST TO ALL NEARBY DRIVERS
    console.log(`\n📢 Broadcasting to ${nearbyDrivers.length} drivers:`);
    let notifiedCount = 0;

    for (const driver of nearbyDrivers) {
      const driverId = driver._id.toString();
      const socketId = global.driverSockets?.get(driverId);

      console.log(
        `   → ${driver.fullname}: ${socketId ? "NOTIFIED ✅" : "NOT CONNECTED ⚠️"}`,
      );

      if (socketId) {
        global.io.to(socketId).emit("rideAssigned", {
          rideId: ride._id.toString(),
          pickup,
          destination,
          pickupCoordinates: pickupLoc,
          destinationCoordinates: destinationLoc,
          distance,
          duration,
          fare: ride.basePrice,
          passengerName: ride.passengers[0].name,
          rideType,
        });
        notifiedCount++;
      }
    }

    console.log(
      `✅ Notified ${notifiedCount}/${nearbyDrivers.length} drivers\n`,
    );

    return res.status(200).json({
      success: true,
      message: `Ride request sent to ${notifiedCount} nearby drivers. First to accept gets the ride.`,
      ride: {
        _id: ride._id,
        status: ride.status,
        driver: ride.driver,
        pickup: ride.pickup,
        destination: ride.destination,
        fare: ride.basePrice,
        distance: ride.distance,
        duration: ride.duration,
      },
      driversNotified: notifiedCount,
    });
  } catch (error) {
    console.error("❌ Ride booking error:", error.message);
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
      "fullname carModel carColor plateNo currentLocation contact profileImg email isActive createdAt",
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
      driver:ride.driver,
      pickup:ride.pickup,
      destination:ride.destination,
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

const getTotalRides = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(404).json({ success: false, message: "Id not found" });
    }

  
    const rides = await ride.find({ driver: id });

    return res.status(200).json({
      success: true,
      message: "Rides found successfully",
      rides,
    });
  } catch (error) {
    console.error("Error fetching rides:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


module.exports = {
  bookRide,
  getAutocompleteSuggestions,
  getRouteAndRides,
  getAvailableRider,
  getRiderById,
  getRideById,
  getTotalRides
};
