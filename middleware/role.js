
const authorizeRole = (role) => {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized",
      });
    }
    next();
  };
};

module.exports = authorizeRole;
