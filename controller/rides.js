require("dotenv").config();

const Ride = require("../model/ride");
const Rider = require("../model/rider");
const axios = require("axios");


function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

    // Validate required fields
    if (!pickup || !destination || !rideType || !passengerName || !fare) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    // Convert pickup address to coordinates
    const pickupGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      { params: { address: pickup, key: process.env.GOOGLE_MAPS_API_KEY } },
    );
    if (pickupGeo.data.status !== "OK" || !pickupGeo.data.results.length) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid pickup address" });
    }
    const pickupLoc = pickupGeo.data.results[0].geometry.location;

    // Convert destination address to coordinates
    const destinationGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: { address: destination, key: process.env.GOOGLE_MAPS_API_KEY },
      },
    );
    if (
      destinationGeo.data.status !== "OK" ||
      !destinationGeo.data.results.length
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid destination address" });
    }
    const destinationLoc = destinationGeo.data.results[0].geometry.location;

    // Get all busy drivers
    const busyDriverIds = await Ride.find({
      status: { $in: ["assigned", "ongoing"] },
    }).distinct("driver");

    // Get all active drivers not busy
    const availableDrivers = await Rider.find({
      isActive: true,
      "currentLocation.latitude": { $ne: null },
      "currentLocation.longitude": { $ne: null },
      _id: { $nin: busyDriverIds },
    });

    if (!availableDrivers.length) {
      return res
        .status(400)
        .json({ success: false, message: "No drivers available" });
    }

    // Find closest driver
    let closestDriver = null;
    let minDistance = Infinity;
    for (const driver of availableDrivers) {
      const d = getDistanceKm(
        pickupLoc.lat,
        pickupLoc.lng,
        driver.currentLocation.latitude,
        driver.currentLocation.longitude,
      );
      if (d < minDistance) {
        minDistance = d;
        closestDriver = driver;
      }
    }

    if (!closestDriver) {
      return res
        .status(400)
        .json({ success: false, message: "No drivers available nearby" });
    }

    // Create ride as REQUESTED (driver has not accepted yet)
    const newRide = await Ride.create({
      pickup,
      pickupCoordinates: pickupLoc,
      destination,
      destinationCoordinates: destinationLoc,
      rideType,
      passengerName,
      fare,
      distance,
      duration,
      status: "requested",
      driver: closestDriver._id,
    });

    // Try sending ride notification if driver is online
    const driverIdStr = closestDriver._id.toString();
    const socketId = global.driverSockets?.get(driverIdStr);

    if (socketId) {
      global.io.to(socketId).emit("rideAssigned", {
        rideId: newRide._id.toString(),
        pickup,
        destination,
        passengerName,
        fare,
        distance,
        duration,
      });
      console.log(`🔔 Ride notification sent to driver ${driverIdStr}`);
    } else {
      console.log(
        `⚠️ Driver ${driverIdStr} not connected. Ride will be sent when they connect.`,
      );
    }

    return res.status(200).json({
      success: true,
      message: "Ride booked and assigned to closest driver",
      ride: newRide,
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
