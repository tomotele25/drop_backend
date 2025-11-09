const User = require("../model/user");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ✅ SIGNUP CONTROLLER
const signup = async (req, res) => {
  try {
    const { email, fullname, contact, password } = req.body;

    if (!email || !fullname || !contact || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Check if user already exists by email or contact
    const existingUser = await User.findOne({
      $or: [{ email }, { contact }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Save new user
    const newUser = new User({
      fullname,
      contact,
      email,
      password: hashedPassword,
      role: "customer",
    });

    await newUser.save();

    return res.status(201).json({
      success: true,
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Signup error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// ✅ LOGIN CONTROLLER
const login = async (req, res) => {
  try {
    const { contact, password } = req.body;

    if (!contact || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // Find user by contact
    const user = await User.findOne({ contact });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log("❌ Password mismatch");
      console.log("Provided:", password);
      console.log("Stored hash:", user.password);
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Sign JWT token
    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2d" }
    );

    return res.status(200).json({
      success: true,
      accessToken,
      user: {
        _id: user._id,
        fullname: user.fullname,
        contact: user.contact,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

module.exports = { signup, login };
