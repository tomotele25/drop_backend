const Rider = require("../model/rider");

const User = require("../model/user");
const bcrypt = require("bcrypt");

const createRider = async (req, res) => {
  try {
    const {
      fullname,
      email,
      password,
      carColor,
      carModel,
      plateNo,
      contact,
      address,
      dob,
      licenseNo,
      emergencyContact,
      bvn,
      profileImg,
      currentLocation,
    } = req.body;

    if (
      !fullname ||
      !email ||
      !password ||
      !carColor ||
      !carModel ||
      !plateNo ||
      !contact ||
      !address ||
      !dob ||
      !licenseNo ||
      !emergencyContact ||
      !bvn
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "All required fields must be filled",
        });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res
        .status(400)
        .json({ success: false, message: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await User.create({
      fullname,
      email,
      password: hashedPassword,
      contact,
      role: "rider",
    });

    // Make sure latitude and longitude are numbers
    const location = {
      latitude: Number(currentLocation?.latitude) || 0,
      longitude: Number(currentLocation?.longitude) || 0,
    };

    const newRider = await Rider.create({
      fullname,
      email,
      carColor,
      carModel,
      plateNo,
      profileImg,
      contact,
      licenseNo,
      dob,
      address,
      emergencyContact,
      bvn,
      user: newUser._id,
      currentLocation: location,
    });

    return res
      .status(201)
      .json({ success: true, message: "Rider created", rider: newRider });
  } catch (error) {
    console.error("Create rider error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};


const getRiderStatus = async (req, res) => {
  try {
    const { id } = req.params; // USER ID

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Rider ID is required" });
    }

    const user = await User.findById(id).select("role");
    if (!user || user.role !== "rider") {
      return res
        .status(404)
        .json({ success: false, message: "User is not a rider" });
    }

    const rider = await Rider.findOne({ user: id }).select("isActive");
    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider profile not found" });
    }

    return res.status(200).json({
      success: true,
      isActive: rider.isActive,
      status: rider.isActive ? "active" : "inactive",
    });
  } catch (error) {
    console.error("Get rider status error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

const toggleRiderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Rider ID required" });
    }

    const rider = await Rider.findOne({ user: id });
    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider profile not found" });
    }

    // Toggle status
    rider.isActive = !rider.isActive;
    await rider.save();

    return res.status(200).json({
      success: true,
      isActive: rider.isActive,
    });
  } catch (error) {
    console.error("Toggle rider status error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};







module.exports = {createRider,getRiderStatus,toggleRiderStatus};
