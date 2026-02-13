const Rider = require("../model/rider");
const User = require("../model/user");
const bcrypt = require("bcrypt");

const createRider = async (req, res) => {
  let createdUserId = null;

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
      latitude,
      longitude,
    } = req.body;

    console.log("=== CREATE RIDER STARTED ===");

    // Validate required fields
    if (
      !fullname ||
      !email ||
      !password ||
      !carColor ||
      !carModel ||
      !plateNo ||
      !contact ||
      !address ||
      !licenseNo ||
      !emergencyContact ||
      !bvn
    ) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    // Check existing user
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already in use",
      });
    }

    // Check existing plate number
    const existingRider = await Rider.findOne({ plateNo });
    if (existingRider) {
      return res.status(400).json({
        success: false,
        message: "Plate number already registered",
      });
    }

    // Check if profile image was uploaded
    const profileImg = req.file?.path;
    if (!profileImg) {
      return res.status(400).json({
        success: false,
        message: "Profile image is required",
      });
    }

    console.log("Profile image uploaded to:", profileImg);

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const newUser = await User.create({
      fullname,
      email,
      password: hashedPassword,
      contact,
      role: "rider",
    });

    createdUserId = newUser._id;
    console.log("User created with ID:", createdUserId);

    // Create rider
    const newRider = await Rider.create({
      fullname,
      email,
      carColor,
      carModel,
      plateNo,
      profileImg,
      contact,
      licenseNo,
      dob: dob || null,
      address,
      emergencyContact,
      bvn,
      user: newUser._id,
      currentLocation: {
        latitude: Number(latitude) || 0,
        longitude: Number(longitude) || 0,
      },
    });

    console.log("✅ Rider created successfully!");

    return res.status(201).json({
      success: true,
      message: "Rider created successfully",
      rider: {
        id: newRider._id,
        fullname: newRider.fullname,
        email: newRider.email,
      },
    });
  } catch (error) {
    // Rollback user if it was created
    if (createdUserId) {
      try {
        await User.findByIdAndDelete(createdUserId);
        console.log("✅ User rolled back");
      } catch (rollbackError) {
        console.log("❌ Rollback failed:", rollbackError.message);
      }
    }

    console.log("=== ERROR ===");
    console.log("Message:", error.message);
    console.log("Stack:", error.stack);

    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: `Validation failed: ${errors.join(", ")}`,
      });
    }

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({
        success: false,
        message: `${field} already exists`,
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || "Server error occurred",
    });
  }
};

const getRiderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Rider ID is required",
      });
    }

    const user = await User.findById(id).select("role");
    if (!user || user.role !== "rider") {
      return res.status(404).json({
        success: false,
        message: "User is not a rider",
      });
    }

    const rider = await Rider.findOne({ user: id }).select("isActive");
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      isActive: rider.isActive,
      status: rider.isActive ? "active" : "inactive",
    });
  } catch (error) {
    console.log("Get rider status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

const toggleRiderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Rider ID required",
      });
    }

    const rider = await Rider.findOne({ user: id });
    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    rider.isActive = !rider.isActive;
    await rider.save();

    return res.status(200).json({
      success: true,
      isActive: rider.isActive,
    });
  } catch (error) {
    console.log("Toggle rider status error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = { createRider, getRiderStatus, toggleRiderStatus };
