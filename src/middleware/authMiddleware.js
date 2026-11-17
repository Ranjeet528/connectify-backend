
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  try {
    const token = req.cookies?.connectify_token;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Please login to access this resource",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found. Please login again",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired session. Please login again",
    });
  }
};

module.exports = authMiddleware;
