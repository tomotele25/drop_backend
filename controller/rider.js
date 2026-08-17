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

    // Required verification photos — driver's face, the vehicle, the
    // license document, and the plate itself. Uploaded via upload.fields()
    // (see routes/riderRoute.js), so each shows up as req.files[field][0]
    // rather than req.file.
    const profileImg = req.files?.profileImg?.[0]?.path;
    const vehiclePhoto = req.files?.vehiclePhoto?.[0]?.path;
    const licensePhoto = req.files?.licensePhoto?.[0]?.path;
    const plateNoPhoto = req.files?.plateNoPhoto?.[0]?.path;

    if (!profileImg || !vehiclePhoto || !licensePhoto || !plateNoPhoto) {
      return res.status(400).json({
        success: false,
        message:
          "Photos of you, your vehicle, your license, and your plate number are all required",
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
              vehiclePhoto,
              licensePhoto,
              plateNoPhoto,
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

// Editable profile fields — deliberately excludes licenseNo, bvn and
// emergencyContact, which are verification-sensitive and shouldn't be
// self-editable without re-verification (matches how most ride-hailing
// apps lock those fields post-onboarding).
const EDITABLE_FIELDS = [
  "fullname",
  "email",
  "contact",
  "address",
  "dob",
  "carModel",
  "carColor",
  "plateNo",
];

// fullname/email/contact are duplicated on both User and Rider (a pre-
// existing shape, not introduced here — see createRider), so both docs are
// updated together in a transaction to keep them from drifting apart.
const updateRiderProfile = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user?.id !== id && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const rider = await Rider.findOne({ user: id });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider profile not found" });
    }

    const updates = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined && req.body[field] !== "") {
        updates[field] = req.body[field];
      }
    }
    if (req.file?.path) {
      updates.profileImg = req.file.path;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No changes provided" });
    }

    const userUpdates = {};
    if (updates.fullname !== undefined) userUpdates.fullname = updates.fullname;
    if (updates.email !== undefined) userUpdates.email = updates.email;
    if (updates.contact !== undefined) userUpdates.contact = updates.contact;

    let updatedRider;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        Object.assign(rider, updates);
        updatedRider = await rider.save({ session });

        if (Object.keys(userUpdates).length > 0) {
          await User.updateOne({ _id: id }, userUpdates, { session });
        }
      });
    } finally {
      session.endSession();
    }

    return res.status(200).json({
      success: true,
      rider: {
        fullname: updatedRider.fullname,
        email: updatedRider.email,
        contact: updatedRider.contact,
        address: updatedRider.address,
        dob: updatedRider.dob,
        carModel: updatedRider.carModel,
        carColor: updatedRider.carColor,
        plateNo: updatedRider.plateNo,
        profileImg: updatedRider.profileImg,
      },
    });
  } catch (error) {
    console.error("Update rider profile error:", error.message);

    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ success: false, message: `Validation failed: ${errors.join(", ")}` });
    }
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({ success: false, message: `${field} already in use` });
    }

    return res.status(500).json({ success: false, message: "Server error" });
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
  updateRiderProfile,
  getBanks,
  updateBankDetails,
};
