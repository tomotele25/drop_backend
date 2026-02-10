const User = require("../model/user");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendSignupEmail  = require("../mailer");
const Rider = require("../model/rider");

// ✅ SIGNUP CONTROLLER
const signup = async (req, res) => {
  try {
    const { email, fullname, contact, password } = req.body;

    // ✅ Validate fields
    if (!email || !fullname || !contact || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    // ✅ Validate email format
    const emailRegex = /\S+@\S+\.\S+/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // ✅ Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // ✅ Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { contact }] });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User with this email or contact already exists",
      });
    }

    // ✅ Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // ✅ Create new user
    const newUser = new User({
      fullname,
      contact,
      email,
      password: hashedPassword,
      role: "customer",
    });

    await newUser.save();

    // ✅ Send signup email asynchronously (non-blocking)
    sendSignupEmail(email, fullname)
      .then(() => console.log("Signup email sent successfully"))
      .catch((err) => console.error("Signup email failed:", err));

    // ✅ Return success response without password
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user: {
        fullname: newUser.fullname,
        email: newUser.email,
        contact: newUser.contact,
        role: newUser.role,
      },
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

      let riderData = {};
      if (user.role === "rider") {
        const rider = await Rider.findOne({ user: user._id });
        if (rider) {
          riderData = {
            riderId: rider._id,
          };
        }
      }

    // Sign JWT token
  const accessToken = jwt.sign(
    {
      id: user._id,
      role: user.role,
      ...(riderData.riderId && { riderId: riderData.riderId }),
    },
    process.env.JWT_SECRET,
    { expiresIn: "2d" },
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
        ...riderData
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
