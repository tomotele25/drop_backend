const Rider = require("../model/rider");
const User = require("../model/user");
const createRider = async (req, res) => {
  const {
    fullname,
    email,
    password,
    carColor,
    carModel,
    plateNo,
    profileImg,
    contact,
  } = req.body;

  try {
    // ✅ Check required fields
    if (
      !fullname ||
      !email ||
      !password ||
      !carColor ||
      !carModel ||
      !contact ||
      !plateNo
    ) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    // ✅ Check if rider already exists
    const existingRider = await Rider.findOne({ email });
    if (existingRider) {
      return res
        .status(400)
        .json({ success: false, message: "Rider already exists." });
    }

    const newUser = new User({
      fullname,
      email,
      password,
      contact,
      role: "rider",
    });
    await newUser.save();

    const newRider = new Rider({
      fullname,
      email,
      password,
      carColor,
      carModel,
      plateNo,
      profileImg,
      contact,
      user: newUser._id,
    });

    await newRider.save();

    res.status(201).json({
      success: true,
      message: "Rider created successfully.",
    });
  } catch (error) {
    console.error("Error creating rider:", error.message);
    res.status(500).json({ success: false, message: "Server error." });
  }
};

module.exports = createRider;
