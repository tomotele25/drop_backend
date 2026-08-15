const mongoose = require("mongoose");
const Rider = require("../model/rider");
const User = require("../model/user");
const bcrypt = require("bcrypt");
const { resolveAccountNumber, createTransferRecipient, listBanks } = require("../utils/paystack");

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

    // User + Rider must exist together or not at all — previously this used
    // a manual "delete the user if Rider.create fails" rollback, which
    // leaves a real window (a crash between the two writes, or the rollback
    // itself failing) where an orphaned User with no matching Rider exists.
    // A transaction removes that window entirely.
    let newUser, newRider;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        [newUser] = await User.create(
          [
            {
              fullname,
              email,
              password: hashedPassword,
              contact,
              role: "rider",
            },
          ],
          { session },
        );

        [newRider] = await Rider.create(
          [
            {
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
              location: {
                type: "Point",
                coordinates: [Number(longitude) || 0, Number(latitude) || 0],
              },
            },
          ],
          { session },
        );
      });
    } finally {
      session.endSession();
    }

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
    // No manual rollback needed — session.withTransaction aborts and
    // rolls back both writes automatically if either one fails.
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

    if (req.user?.id !== id && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized" });
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

    if (req.user?.id !== id && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized" });
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

// ================= PAYOUT BANK DETAILS =================

const getBanks = async (_req, res) => {
  try {
    const banks = await listBanks();
    return res.status(200).json({ success: true, banks: banks.data });
  } catch (error) {
    console.error("List banks error:", error?.response?.data || error.message);
    return res.status(500).json({ success: false, message: "Could not fetch bank list" });
  }
};

// Resolves the account number against the bank (proving the driver actually
// owns it), then registers it as a Paystack transfer recipient so the daily
// payout job has somewhere to send money.
const updateBankDetails = async (req, res) => {
  try {
    if (!req.user?.riderId) {
      return res.status(403).json({ success: false, message: "Drivers only" });
    }

    const { accountNumber, bankCode, bankName } = req.body;
    if (!accountNumber || !bankCode || !bankName) {
      return res.status(400).json({
        success: false,
        message: "accountNumber, bankCode and bankName are required",
      });
    }

    const resolved = await resolveAccountNumber({ accountNumber, bankCode });
    if (!resolved?.data?.account_name) {
      return res.status(400).json({ success: false, message: "Could not verify account" });
    }
    const accountName = resolved.data.account_name;

    const recipient = await createTransferRecipient({
      name: accountName,
      accountNumber,
      bankCode,
    });

    const rider = await Rider.findByIdAndUpdate(
      req.user.riderId,
      {
        bankCode,
        bankName,
        accountNumber,
        accountName,
        paystackRecipientCode: recipient.data.recipient_code,
      },
      { new: true },
    );

    return res.status(200).json({
      success: true,
      bankDetails: {
        bankName: rider.bankName,
        accountNumber: rider.accountNumber,
        accountName: rider.accountName,
      },
    });
  } catch (error) {
    console.error("Update bank details error:", error?.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message: error?.response?.data?.message || "Could not verify/save bank details",
    });
  }
};

module.exports = {
  createRider,
  getRiderStatus,
  toggleRiderStatus,
  getBanks,
  updateBankDetails,
};
