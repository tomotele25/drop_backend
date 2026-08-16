require("dotenv").config();

const mongoose = require("mongoose");
const ride = require("../model/ride");
const Ride = require("../model/ride");
const Rider = require("../model/rider");
const User = require("../model/user");
const Wallet = require("../model/wallet");
const Transaction = require("../model/transaction");
const DriverEarning = require("../model/driverEarning");
const DriverCommission = require("../model/driverCommission");
const axios = require("axios");
const { initializeTransaction } = require("../utils/paystack");
const { PLATFORM_COMMISSION_RATE } = require("../config/earnings");
const { RIDE_OFFER_TIMEOUT_MS } = require("../config/dispatch");
const { sendPushToUser } = require("../utils/webpush");
const { sendExpoPushToUser } = require("../utils/expoPush");

// Thrown inside a transaction to abort it cleanly and distinguish "not
// enough balance" (an expected, user-facing case) from a real DB error.
class InsufficientBalanceError extends Error {}



// Re-queried at the actual moment of dispatch (not reused from booking time)
// so a Paystack payment that takes a while to confirm still dispatches
// against who's *currently* available, not who was available at checkout.
//
// Uses the 2dsphere index on Rider.location via $near instead of fetching
// every active driver citywide into memory and Haversine-filtering in JS —
// that pattern doesn't scale past a small driver count. $near already
// returns results sorted nearest-first, bounded by $maxDistance, at the
// index level.
const findAvailableNearbyDrivers = async (pickupLoc, radiusKm = 10) => {
  const busyDriverIds = await Ride.find({
    status: { $in: ["ongoing", "accepted", "arrived"] },
  }).distinct("driver");

  // Self-heal: `location` (the GeoJSON field $near actually queries) and
  // `currentLocation` (the flat lat/lng field shown elsewhere, e.g.
  // getAvailableRider) are supposed to be written together, but any Rider
  // document created before `location` existed on the schema has it stuck
  // at the default [0,0] — ~780km from Lagos, so it silently never matches
  // $near even though the driver is genuinely online with a real
  // currentLocation. Backfill those before matching so a driver who's
  // active right now isn't invisible to dispatch until their next socket
  // reconnect.
  await Rider.updateMany(
    {
      isActive: true,
      "location.coordinates": [0, 0],
      "currentLocation.latitude": { $ne: 0 },
    },
    [
      {
        $set: {
          location: {
            type: "Point",
            coordinates: ["$currentLocation.longitude", "$currentLocation.latitude"],
          },
        },
      },
    ],
  );

  const availableDrivers = await Rider.find({
    isActive: true,
    _id: { $nin: busyDriverIds },
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [pickupLoc.lng, pickupLoc.lat] },
        $maxDistance: radiusKm * 1000,
      },
    },
  });

  return availableDrivers;
};

// Admin-triggerable version of the self-heal step in
// findAvailableNearbyDrivers, so currently-online drivers with a stale
// `location` field can be fixed immediately instead of waiting for the
// next ride booking to implicitly backfill them.
const backfillDriverLocations = async (req, res) => {
  try {
    const result = await Rider.updateMany(
      {
        isActive: true,
        "location.coordinates": [0, 0],
        "currentLocation.latitude": { $ne: 0 },
      },
      [
        {
          $set: {
            location: {
              type: "Point",
              coordinates: ["$currentLocation.longitude", "$currentLocation.latitude"],
            },
          },
        },
      ],
    );
    return res.status(200).json({ success: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (error) {
    console.error("Backfill driver locations error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Shared by both the wallet path (dispatches immediately after booking) and
// the Paystack webhook (dispatches only once payment is confirmed).
const dispatchRideToDrivers = async (rideDoc) => {
  const nearbyDrivers = await findAvailableNearbyDrivers(
    rideDoc.pickupCoordinates,
    10,
  );

  const driverIds = nearbyDrivers.map((d) => d._id.toString());
  global.rideOffers = global.rideOffers || new Map();
  global.rideOffers.set(rideDoc._id.toString(), {
    offeredAt: Date.now(),
    offeredTo: driverIds,
    acceptedBy: null,
  });

  let notifiedCount = 0;
  for (const driver of nearbyDrivers) {
    const driverId = driver._id.toString();
    const socketId = global.driverSockets?.get(driverId);
    if (socketId) {
      global.io.to(socketId).emit("rideAssigned", {
        rideId: rideDoc._id.toString(),
        pickup: rideDoc.pickup,
        destination: rideDoc.destination,
        pickupCoordinates: rideDoc.pickupCoordinates,
        destinationCoordinates: rideDoc.destinationCoordinates,
        distance: rideDoc.distance,
        duration: rideDoc.duration,
        fare: rideDoc.basePrice,
        passengerName: rideDoc.passengers?.[0]?.name,
        rideType: rideDoc.rideType,
      });
      notifiedCount++;
    }

    // Push goes out regardless of live socket status — it's the channel
    // that can still reach a driver whose tab isn't focused. Fire-and-forget:
    // a push failure shouldn't block dispatching to the rest of the drivers.
    if (driver.user) {
      const pushPayload = {
        title: "New ride request",
        body: `${rideDoc.pickup} → ${rideDoc.destination} · ₦${rideDoc.basePrice}`,
        url: `/ride/${rideDoc._id.toString()}`,
        rideId: rideDoc._id.toString(),
      };
      sendPushToUser(driver.user, pushPayload).catch((err) =>
        console.error("Push dispatch error:", err.message),
      );
      sendExpoPushToUser(driver.user, pushPayload).catch((err) =>
        console.error("Expo push dispatch error:", err.message),
      );
    }
  }

  return { nearbyDrivers, notifiedCount };
};

// Creates the driver's earning ledger row the moment a ride is genuinely
// finished and paid for. The unique index on `ride` makes this safe to call
// from both the REST completeRide endpoint and the socket endTrip handler
// without risking a duplicate payout entry.
//
// Branches on paymentMethod: wallet/paystack rides mean the platform
// collected the money, so it owes the driver a payout (DriverEarning).
// cash/transfer rides mean the *driver* collected the money directly from
// the customer, so it's the reverse — the driver owes the platform its
// commission (DriverCommission). Same commission math either way, opposite
// direction of who owes whom.
const settleDriverEarning = async (rideDoc) => {
  if (!rideDoc.driver || rideDoc.paymentStatus !== "paid") return;

  const commissionRate = PLATFORM_COMMISSION_RATE;
  const commissionAmount = Math.round(rideDoc.basePrice * commissionRate);

  const isDirectToDriver =
    rideDoc.paymentMethod === "cash" || rideDoc.paymentMethod === "transfer";

  try {
    if (isDirectToDriver) {
      await DriverCommission.create({
        driver: rideDoc.driver,
        ride: rideDoc._id,
        grossAmount: rideDoc.basePrice,
        commissionRate,
        commissionAmount,
      });
    } else {
      const netEarning = rideDoc.basePrice - commissionAmount;
      await DriverEarning.create({
        driver: rideDoc.driver,
        ride: rideDoc._id,
        grossAmount: rideDoc.basePrice,
        commissionRate,
        commissionAmount,
        netEarning,
      });
    }
  } catch (err) {
    if (err.code === 11000) return; // already settled for this ride — ignore
    console.error("Failed to create driver settlement ledger row:", err.message);
  }
};

// Auto-expires a ride that's been dispatched (paid, broadcast to drivers)
// but sat "pending" with no acceptance past the timeout — otherwise these
// hang forever with no customer-visible signal. Only touches paid rides:
// an unpaid Paystack ride sitting "pending" is a different lifecycle
// (waiting on checkout, not on driver acceptance) and isn't dispatched yet.
const expireStalePendingRides = async () => {
  const cutoff = new Date(Date.now() - RIDE_OFFER_TIMEOUT_MS);
  const staleRides = await Ride.find({
    status: "pending",
    paymentStatus: "paid",
    requestedAt: { $lt: cutoff },
  });

  if (staleRides.length === 0) return;

  await Ride.updateMany(
    { _id: { $in: staleRides.map((r) => r._id) } },
    { status: "no_drivers_available" },
  );

  for (const staleRide of staleRides) {
    global.rideOffers?.delete(staleRide._id.toString());

    const passengerId = staleRide.passengers?.[0]?.userId?.toString();
    if (global.io && passengerId) {
      const riderSocketId = global.riderSockets?.get(passengerId);
      if (riderSocketId) {
        global.io.to(riderSocketId).emit("rideExpired", {
          rideId: staleRide._id.toString(),
          message: "No drivers responded in time.",
        });
      }
    }
  }

  console.log(`⏱️ Expired ${staleRides.length} stale pending ride(s)`);
};

const bookRide = async (req, res) => {
  try {
    const { pickup, destination, rideType, passengers, paymentMethod } = req.body;

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

    // Wallet/Paystack accepted in the API for when they're switched back on
    // (business verification pending) — the booking UI currently only
    // offers cash/transfer.
    if (!["wallet", "paystack", "cash", "transfer"].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: "paymentMethod must be 'wallet', 'paystack', 'cash', or 'transfer'",
      });
    }

    // Fare is always computed server-side below; any client-supplied `fare` is ignored.
    let basePrice = 0;

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

    // CALCULATE FARE (server-side only — never trust a client-supplied fare)
    const BASE_FARES = { standard: 500, premium: 1000 };
    const PER_KM = 149;
    const PER_MINUTE = 22;

    const normalizedType = rideType.toLowerCase();
    if (!(normalizedType in BASE_FARES)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ride type",
      });
    }

    const fareCalc =
      BASE_FARES[normalizedType] + distance * PER_KM + duration * PER_MINUTE;

    basePrice = Math.ceil(fareCalc / 50) * 50;

    // Pre-flight check only — confirms drivers exist before we ever charge
    // the customer. The actual dispatch re-queries fresh availability later.
    const preCheckDrivers = await findAvailableNearbyDrivers(pickupLoc, 10);
    if (!preCheckDrivers.length) {
      return res.status(400).json({
        success: false,
        message: "No drivers available nearby",
      });
    }

    // ✅ CREATE RIDE WITH NO DRIVER ASSIGNED, UNPAID UNTIL PAYMENT SETTLES
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
      paymentMethod,
      paymentStatus: "unpaid",
      requestedAt: new Date(),
      rejectedBy: [],
    });

    console.log(`📝 Ride created: ${ride._id} (payment: ${paymentMethod})`);

    if (paymentMethod === "cash" || paymentMethod === "transfer") {
      // Money never touches the platform here — the customer pays the
      // driver directly. Nothing to collect or verify, so dispatch
      // immediately. paymentStatus "paid" here means "nothing pending that
      // blocks dispatch/settlement", not literally "the platform holds the
      // money" — settleDriverEarning() branches on paymentMethod to create
      // a commission debt (driver owes platform) instead of a payout
      // (platform owes driver) for these two methods.
      ride.paymentStatus = "paid";
      await ride.save();

      const { notifiedCount } = await dispatchRideToDrivers(ride);

      return res.status(200).json({
        success: true,
        message: `Ride request sent to ${notifiedCount} nearby drivers. Pay your driver directly by ${paymentMethod === "cash" ? "cash" : "bank transfer"}.`,
        ride: {
          _id: ride._id,
          status: ride.status,
          paymentStatus: ride.paymentStatus,
          paymentMethod: ride.paymentMethod,
          driver: ride.driver,
          pickup: ride.pickup,
          destination: ride.destination,
          fare: ride.basePrice,
          distance: ride.distance,
          duration: ride.duration,
        },
        driversNotified: notifiedCount,
      });
    }

    if (paymentMethod === "wallet") {
      // Debit, ledger entry, and marking the ride paid all need to happen
      // together — previously these were three separate sequential writes,
      // so a crash between them could leave a debited wallet with no
      // ledger record, or a "paid" ride with no matching debit. Wrapped in
      // a transaction so it's all-or-nothing.
      const session = await mongoose.startSession();
      let wallet;
      try {
        await session.withTransaction(async () => {
          // Atomic, balance-guarded debit — cannot go negative even under concurrent spends.
          wallet = await Wallet.findOneAndUpdate(
            { user: req.user.id, balance: { $gte: basePrice } },
            { $inc: { balance: -basePrice } },
            { new: true, session },
          );

          if (!wallet) {
            throw new InsufficientBalanceError();
          }

          await Transaction.create(
            [
              {
                user: req.user.id,
                type: "order_payment",
                method: "wallet",
                reference: `WALLET-ORDER-${ride._id}`,
                amount: basePrice,
                status: "success",
                orderType: "Ride",
                orderId: ride._id,
              },
            ],
            { session },
          );

          ride.paymentStatus = "paid";
          await ride.save({ session });
        });
      } catch (err) {
        if (err instanceof InsufficientBalanceError) {
          await Ride.findByIdAndDelete(ride._id);
          return res.status(402).json({
            success: false,
            message: "Insufficient wallet balance",
          });
        }
        throw err;
      } finally {
        session.endSession();
      }

      // Dispatch is deliberately outside the transaction — it's a real-time
      // side effect (DB queries + socket emits), not something that should
      // roll back the payment if a driver-lookup call happens to be slow.
      const { notifiedCount } = await dispatchRideToDrivers(ride);

      return res.status(200).json({
        success: true,
        message: `Paid from wallet. Ride request sent to ${notifiedCount} nearby drivers.`,
        ride: {
          _id: ride._id,
          status: ride.status,
          paymentStatus: ride.paymentStatus,
          driver: ride.driver,
          pickup: ride.pickup,
          destination: ride.destination,
          fare: ride.basePrice,
          distance: ride.distance,
          duration: ride.duration,
        },
        driversNotified: notifiedCount,
      });
    }

    // paymentMethod === "paystack" — customer pays first via Paystack
    // (card or Paystack's own bank-transfer channel), driver dispatch only
    // happens once the webhook confirms the charge.
    const requester = await User.findById(req.user.id).select("email");
    const reference = `RIDE-${ride._id}-${Date.now()}`;

    await Transaction.create({
      user: req.user.id,
      type: "order_payment",
      method: "paystack",
      reference,
      amount: basePrice,
      status: "pending",
      orderType: "Ride",
      orderId: ride._id,
    });

    const paystackRes = await initializeTransaction({
      email: requester.email,
      amountNaira: basePrice,
      reference,
      metadata: { rideId: ride._id.toString(), type: "order_payment" },
      callback_url: process.env.FRONTEND_URL
        ? `${process.env.FRONTEND_URL}/ride-tracking/RideTracking?rideId=${ride._id}`
        : undefined,
    });

    return res.status(200).json({
      success: true,
      message: "Ride created. Complete payment to notify nearby drivers.",
      ride: {
        _id: ride._id,
        status: ride.status,
        paymentStatus: ride.paymentStatus,
        pickup: ride.pickup,
        destination: ride.destination,
        fare: ride.basePrice,
        distance: ride.distance,
        duration: ride.duration,
      },
      payment: {
        authorization_url: paystackRes.data.authorization_url,
        reference,
      },
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

// ================= GEOCODE (single address → lat/lng) =================
// Autocomplete only returns place_id/description (no coordinates — that's
// how Google's Autocomplete API works), so the mobile map needs this to
// place an accurate pin as soon as pickup or destination is picked, before
// both are known (bookRide/getRouteAndRides only geocode once you already
// have a full pickup+destination pair).
const geocodeAddress = async (req, res) => {
  try {
    const { address } = req.body || {};
    if (!address) {
      return res.status(400).json({ success: false, message: "address is required" });
    }

    const geo = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: { address, key: process.env.GOOGLE_MAPS_API_KEY },
    });

    if (geo.data.status !== "OK") {
      return res.status(400).json({ success: false, message: "Could not resolve address" });
    }

    const { lat, lng } = geo.data.results[0].geometry.location;
    return res.status(200).json({ success: true, lat, lng });
  } catch (error) {
    console.error("Geocode error:", error);
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

    const requesterId = req.user?.id;
    const isPassenger = ride.passengers.some(
      (p) => p.userId?.toString() === requesterId,
    );
    const isDriver =
      ride.driver?.user?.toString() === requesterId ||
      ride.driver?._id?.toString() === req.user?.riderId;
    const isAdmin = req.user?.role === "admin";

    if (!isPassenger && !isDriver && !isAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized to view this ride" });
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

    const isAdmin = req.user?.role === "admin";
    const isSelf = req.user?.riderId === id;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, message: "Not authorized" });
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

// Customer-facing ride history — rides the given user is a passenger on
// (as opposed to getTotalRides above, which is the driver's ride history).
const getCustomerRides = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(404).json({ success: false, message: "Id not found" });
    }

    const isAdmin = req.user?.role === "admin";
    const isSelf = req.user?.id === id;
    if (!isAdmin && !isSelf) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const rides = await Ride.find({ "passengers.userId": id }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: "Rides found successfully",
      rides,
    });
  } catch (error) {
    console.error("Error fetching customer rides:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};


// ================= CANCEL RIDE =================
// Customer, the assigned driver, or an admin can cancel — but only while the
// ride hasn't already started/finished. The atomic status-guarded update
// prevents cancelling a ride that has concurrently moved to "ongoing"/"completed".
const cancelRide = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};

    const existing = await Ride.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    const isAdmin = req.user?.role === "admin";
    const isDriver =
      existing.driver && existing.driver.toString() === req.user?.riderId;
    const isPassenger = existing.passengers.some(
      (p) => p.userId?.toString() === req.user?.id,
    );

    if (!isAdmin && !isDriver && !isPassenger) {
      return res.status(403).json({ success: false, message: "Not authorized to cancel this ride" });
    }

    const cancelledBy = isAdmin ? "admin" : isDriver ? "driver" : "customer";

    const ride = await Ride.findOneAndUpdate(
      { _id: id, status: { $in: ["pending", "requested", "accepted", "arrived"] } },
      {
        status: "cancelled",
        cancelledBy,
        cancelReason: reason || null,
        cancelledAt: new Date(),
      },
      { new: true },
    );

    if (!ride) {
      return res.status(409).json({
        success: false,
        message: "Ride can no longer be cancelled (already ongoing, completed, or cancelled)",
      });
    }

    // Refund a wallet-paid ride — this was previously missing entirely: a
    // customer who paid from their wallet and then cancelled just lost that
    // money with no way to get it back. The cancellation above already
    // committed atomically; the refund is a best-effort compensating action
    // on top of it, wrapped in its own transaction so the wallet credit and
    // the ledger entry land together.
    let refunded = false;
    if (ride.paymentMethod === "wallet" && ride.paymentStatus === "paid") {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await Wallet.findOneAndUpdate(
            { user: ride.passengers?.[0]?.userId },
            { $inc: { balance: ride.basePrice } },
            { upsert: true, session },
          );
          await Transaction.create(
            [
              {
                user: ride.passengers?.[0]?.userId,
                type: "refund",
                method: "wallet",
                reference: `REFUND-${ride._id}`,
                amount: ride.basePrice,
                status: "success",
                orderType: "Ride",
                orderId: ride._id,
              },
            ],
            { session },
          );
          await Ride.updateOne(
            { _id: ride._id },
            { paymentStatus: "refunded" },
            { session },
          );
        });
        refunded = true;
        ride.paymentStatus = "refunded";
      } catch (err) {
        // The cancellation itself already succeeded and must not be rolled
        // back for this — log loudly so it surfaces for manual reconciliation
        // rather than silently losing the customer's money.
        console.error(`❌ Refund failed for cancelled ride ${ride._id}:`, err.message);
      } finally {
        session.endSession();
      }
    } else if (ride.paymentMethod === "paystack" && ride.paymentStatus === "paid") {
      // No automated Paystack refund yet — flagging this loudly rather than
      // silently doing nothing, since real money is owed back here.
      console.warn(
        `⚠️ Ride ${ride._id} cancelled with a paid Paystack transaction — refund must be issued manually via the Paystack dashboard.`,
      );
    }

    // Notify the other party in real time if they're connected.
    const passengerId = ride.passengers?.[0]?.userId?.toString();
    if (global.io) {
      if (ride.driver) {
        const driverSocketId = global.driverSockets?.get(ride.driver.toString());
        if (driverSocketId) global.io.to(driverSocketId).emit("rideCancelled", { rideId: ride._id.toString(), by: cancelledBy });
      }
      if (passengerId) {
        const riderSocketId = global.riderSockets?.get(passengerId);
        if (riderSocketId) global.io.to(riderSocketId).emit("rideCancelled", { rideId: ride._id.toString(), by: cancelledBy });
      }
    }

    // If a driver was already offered/assigned this ride, drop it from the in-memory offer map too.
    if (global.rideOffers?.has(id)) global.rideOffers.delete(id);

    return res.status(200).json({ success: true, ride, refunded });
  } catch (error) {
    console.error("Cancel ride error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= DRIVER ACTION ENDPOINTS (REST fallback for the socket events) =================
// These mirror the atomic, status-guarded transitions in api/server.js's socket
// handlers so a driver app that isn't connected over a live socket (or whose
// emit silently dropped) still has a reliable way to progress a ride's status.

const markArrivedAtPickup = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user?.riderId) {
      return res.status(403).json({ success: false, message: "Drivers only" });
    }

    const ride = await Ride.findOneAndUpdate(
      { _id: id, status: "accepted", driver: req.user.riderId },
      { status: "arrived", arrivedAt: new Date() },
      { new: true },
    );

    if (!ride) {
      return res.status(409).json({ success: false, message: "Ride is not in accepted status" });
    }

    const passengerId = ride.passengers?.[0]?.userId?.toString();
    if (global.io && passengerId) {
      const riderSocketId = global.riderSockets?.get(passengerId);
      if (riderSocketId) {
        global.io.to(riderSocketId).emit("driverArrived", { rideId: ride._id.toString(), ride });
      }
    }
    if (passengerId) {
      sendExpoPushToUser(passengerId, {
        title: "Your driver has arrived",
        body: `Your driver is waiting at ${ride.pickup}`,
        url: `/ride/${ride._id.toString()}`,
        rideId: ride._id.toString(),
      }).catch((err) => console.error("Expo push (arrived) error:", err.message));
    }

    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error("Mark arrived error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const markPickedUp = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user?.riderId) {
      return res.status(403).json({ success: false, message: "Drivers only" });
    }

    const ride = await Ride.findOneAndUpdate(
      { _id: id, status: "arrived", driver: req.user.riderId },
      { status: "ongoing", startedAt: new Date() },
      { new: true },
    );

    if (!ride) {
      return res.status(409).json({ success: false, message: "Ride is not in arrived status" });
    }

    const passengerId = ride.passengers?.[0]?.userId?.toString();
    if (global.io && passengerId) {
      const riderSocketId = global.riderSockets?.get(passengerId);
      if (riderSocketId) {
        global.io.to(riderSocketId).emit("rideOngoing", { rideId: ride._id.toString(), ride });
      }
    }
    if (passengerId) {
      sendExpoPushToUser(passengerId, {
        title: "Trip started",
        body: `You're on your way to ${ride.destination}`,
        url: `/ride/${ride._id.toString()}`,
        rideId: ride._id.toString(),
      }).catch((err) => console.error("Expo push (ongoing) error:", err.message));
    }

    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error("Mark picked up error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const completeRide = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.user?.riderId) {
      return res.status(403).json({ success: false, message: "Drivers only" });
    }

    const ride = await Ride.findOneAndUpdate(
      { _id: id, status: "ongoing", driver: req.user.riderId },
      { status: "completed", completedAt: new Date() },
      { new: true },
    );

    if (!ride) {
      return res.status(409).json({ success: false, message: "Ride is not ongoing" });
    }

    await settleDriverEarning(ride);

    const passengerId = ride.passengers?.[0]?.userId?.toString();
    if (global.io && passengerId) {
      const riderSocketId = global.riderSockets?.get(passengerId);
      if (riderSocketId) {
        global.io.to(riderSocketId).emit("rideCompleted", { rideId: ride._id.toString(), ride });
      }
    }
    if (passengerId) {
      sendExpoPushToUser(passengerId, {
        title: "Trip completed",
        body: `You've arrived at ${ride.destination}`,
        url: `/ride/${ride._id.toString()}`,
        rideId: ride._id.toString(),
      }).catch((err) => console.error("Expo push (completed) error:", err.message));
    }

    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error("Complete ride error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Lets the passenger rate a completed ride. Only the passenger who took
// the ride can rate it, only once it's actually completed, and rating is
// one-shot (no overwriting a previous rating via this endpoint).
const rateRide = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, review } = req.body || {};

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: "rating must be an integer 1-5" });
    }

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    const isPassenger = ride.passengers.some(
      (p) => p.userId?.toString() === req.user.id,
    );
    if (!isPassenger) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }
    if (ride.status !== "completed") {
      return res.status(409).json({ success: false, message: "Ride is not completed yet" });
    }
    if (ride.rating != null) {
      return res.status(409).json({ success: false, message: "Ride already rated" });
    }

    ride.rating = rating;
    if (review) ride.review = review;
    await ride.save();

    return res.status(200).json({ success: true, ride });
  } catch (error) {
    console.error("Rate ride error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  bookRide,
  getAutocompleteSuggestions,
  getRouteAndRides,
  getAvailableRider,
  getRiderById,
  getRideById,
  getTotalRides,
  getCustomerRides,
  cancelRide,
  markArrivedAtPickup,
  markPickedUp,
  completeRide,
  rateRide,
  geocodeAddress,
  backfillDriverLocations,
  dispatchRideToDrivers,
  settleDriverEarning,
  expireStalePendingRides,
};
