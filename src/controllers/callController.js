const Call = require("../models/Call");

const getCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 20)
    );

    const filter = {
      $or: [{ caller: userId }, { receiver: userId }],
      hiddenFor: { $ne: userId },
    };

    const allowedStatuses = [
      "ringing",
      "accepted",
      "rejected",
      "missed",
      "ended",
      "failed",
      "cancelled",
    ];

    if (req.query.status) {
      if (!allowedStatuses.includes(req.query.status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid call status",
        });
      }

      filter.status = req.query.status;
    }

    if (req.query.type) {
      if (!["audio", "video"].includes(req.query.type)) {
        return res.status(400).json({
          success: false,
          message: "Invalid call type",
        });
      }

      filter.callType = req.query.type;
    }

    if (req.query.direction === "incoming") {
      filter.$or = [{ receiver: userId }];
    } else if (req.query.direction === "outgoing") {
      filter.$or = [{ caller: userId }];
    } else if (
      req.query.direction &&
      !["all", "incoming", "outgoing"].includes(req.query.direction)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid call direction",
      });
    }

    const skip = (page - 1) * limit;

    const [calls, total] = await Promise.all([
      Call.find(filter)
        .populate("caller", "name avatar")
        .populate("receiver", "name avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Call.countDocuments(filter),
    ]);

    const formattedCalls = calls.map((call) => ({
      ...call,
      direction:
        String(call.caller?._id) === String(userId)
          ? "outgoing"
          : "incoming",
      otherUser:
        String(call.caller?._id) === String(userId)
          ? call.receiver
          : call.caller,
    }));

    return res.status(200).json({
      success: true,
      count: formattedCalls.length,
      total,
      page,
      pages: Math.ceil(total / limit),
      calls: formattedCalls,
    });
  } catch (error) {
    console.error("Get call history error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch call history",
    });
  }
};


const getTurnCredentials = async (req, res) => {
  try {
    const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

    if (!keyId || !apiToken) {
      console.error("Cloudflare TURN environment variables are missing");
      return res.status(500).json({
        success: false,
        message: "TURN service is not configured",
      });
    }

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 86400 }),
        signal: AbortSignal.timeout(15000),
      }
    );

    const data = await response.json();

    if (!response.ok || !Array.isArray(data.iceServers)) {
      console.error("Cloudflare TURN credential request failed:", response.status);
      return res.status(502).json({
        success: false,
        message: "Unable to generate TURN credentials",
      });
    }

    // Port 53 alternate URLs are excluded because browsers/ISPs may block them.
    const iceServers = data.iceServers.map((server) => ({
      ...server,
      urls: Array.isArray(server.urls)
        ? server.urls.filter((url) => !/:53(?:\?|$)/.test(url))
        : server.urls,
    }));

    return res.status(200).json({
      success: true,
      iceServers,
      expiresIn: 86400,
    });
  } catch (error) {
    console.error("Get TURN credentials error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to generate TURN credentials",
    });
  }
};

exports.clearCallHistory = async (req, res) => {
  try {
    const userId = req.user._id;

    await Call.updateMany(
      {
        $or: [{ caller: userId }, { receiver: userId }],
        hiddenFor: { $ne: userId },
      },
      { $addToSet: { hiddenFor: userId } }
    );

    return res.status(200).json({
      success: true,
      message: "Your call history has been cleared",
    });
  } catch (error) {
    console.error("Clear call history error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to clear call history",
    });
  }
};

module.exports = {
  getCallHistory,
  getTurnCredentials,
  clearCallHistory: exports.clearCallHistory,
};
