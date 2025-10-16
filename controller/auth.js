const User = require("../model/user");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const signup = async (req, res) => {
  const { email, fullname, contact, password } = req.body;
  try {
    if (!email || !fullname || !contact || !password) {
      return res.status(400).json({ success: false, message });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await new User({
      fullname,
      contact,
      email,
      password: hashedPassword,
      role: "customer",
    });

    newUser.save();

    res.status(200).json({
      success: true,
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Error Signing up", error.message);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const login = async (req, res) => {
  try {
    const { contact, password } = req.body;

    if (!contact || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const user = await User.findOne({ contact });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const accessToken = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "2d",
    });

    res.status(200).json({
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
    console.error("Login error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { login, signup };
