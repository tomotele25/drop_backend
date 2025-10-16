const Rides = require("../model/ride");
const Rider = require("../model/rider");
const bookRide = async (req, res) => {
  const { seats, location, destination, rideType, driver, price } = req.body;

  try {
    // Validate all required fields
    if (!seats || !location || !destination || !rideType || !driver || !price) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const newRide = new Rides({
      seats,
      location,
      destination,
      rideType,
      driver,
      price,
      bookedAt: new Date(),
    });

    await newRide.save();

    res.status(200).json({
      success: true,
      message: "Ride booked successfully",
      ride: newRide,
    });
  } catch (error) {
    console.error("Error booking ride:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error. Could not book ride." });
  }
};

const getAvailableRides = async (req, res) => {
  try {
    const availableRides = await Rider.find({ isActive: true }).select(
      "fullname carModel carColor currentLocation slug plateNo"
    );
    res.status(200).json({ success: true, rides: availableRides });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { bookRide, getAvailableRides };
