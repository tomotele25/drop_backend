const jwt = require("jsonwebtoken")

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "No token" });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return res.status(401).json({ success: false, message: "Invalid token" });
    req.user = decoded;
    next();
  });
};


const ridersOnly = (req, res, next) => {
  try {
    // Assuming you attach the user to req.user after authentication
    const user = req.user;

    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Not authenticated" });
    }

    if (user.role !== "rider") {
      return res
        .status(403)
        .json({ success: false, message: "Access denied. Riders only" });
    }

    // User is a rider, continue
    next();
  } catch (error) {
    console.error("Riders middleware error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { authenticateToken, ridersOnly };
