const User = require("../models/User");

exports.getUsers = async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();

    if (search.length < 2) {
      return res.status(200).json({
        success: true,
        count: 0,
        users: [],
      });
    }

    const users = await User.find({
      _id: { $ne: req.user._id },
      email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
    })
      .select("_id name email avatar about isOnline lastSeen")
      .limit(10)
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      success: true,
      count: users.length,
      users,
    });
  } catch (error) {
    console.error("Search users error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to search users",
    });
  }
};
