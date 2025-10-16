const Rider = require("../model/rider");
const bcrypt = require("bcrypt");
const User = require("../model/user");
const createRider = async (req, res) => {
  try {
    const {
      fullname,
      plateNo,
      carModel,
      carColor,
      contact,
      email,
      profileImg,
      password,
      isActive,
      address,
    } = req.body;

    if (
      !fullname ||
      !plateNo ||
      !carModel ||
      !carColor ||
      !contact ||
      !isActive ||
      !password ||
      !email
    ) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required" });
    }

    const existingRider = await Rider.findOne({ email });

    if (existingRider) {
      return res
        .status(400)
        .json({ success: false, message: "User already exist" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newRider = new Rider({
      fullname,
      plateNo,
      contact,
      carColor,
      carModel,
      password: hashedPassword,
      isActive,
      profileImg,
      address,
    });

    const newUser = new User({
      fullname,
      password,
      email,
      contact,
      role: "rider",
    });

    await newRider.save();
    await newUser.save();

    res.status(200).json({
      success: true,
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Error Signing up:", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = createRider;
