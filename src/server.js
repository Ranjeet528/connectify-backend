
const express = require("express");
const http = require("http");
const cors = require("cors");
const dotenv = require("dotenv");
dotenv.config();

const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { randomUUID } = require("crypto");

const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const messageRoutes = require("./routes/messageRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const mediaRoutes = require("./routes/mediaRoutes");
const callRoutes = require("./routes/callRoutes");

const connectDB = require("./config/db");
const User = require("./models/User");
const Message = require("./models/Message");
const Call = require("./models/Call");

const app = express();
const httpServer = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({ origin: [CLIENT_URL, "http://localhost:3000", "http://192.168.0.183:3000"], credentials: true }));
app.use(express.json());
app.use(cookieParser());

// =====================================
// API ROUTES
// =====================================

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/calls", callRoutes);

// =====================================
// HEALTH CHECK
// =====================================

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Connectify API is running!",
    project: "Connectify",
  });
});

// =====================================
// SOCKET.IO SETUP
// =====================================

const io = new Server(httpServer, {
  cors: {
    origin: [CLIENT_URL, "http://localhost:3000", "http://192.168.0.183:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

app.set("io", io);

// =====================================
// ONLINE USERS AND ACTIVE CALLS
// =====================================

const onlineUsers = new Map();
const activeCalls = new Map();
const disconnectTimers = new Map();

// =====================================
// SOCKET AUTHENTICATION
// =====================================

io.use((socket, next) => {
  try {
    const rawCookie = socket.handshake.headers.cookie || "";

    const token = rawCookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("connectify_token="))
      ?.slice("connectify_token=".length);

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const decodedToken = decodeURIComponent(token);

    const decoded = jwt.verify(
      decodedToken,
      process.env.JWT_SECRET
    );

    socket.userId = String(decoded.userId || decoded.id);

    if (!socket.userId || socket.userId === "undefined") {
      return next(new Error("Invalid user session"));
    }

    next();
  } catch (error) {
    console.error(
      "Socket authentication error:",
      error.name,
      error.message
    );

    next(new Error("Invalid or expired session"));
  }
});

// =====================================
// HELPERS
// =====================================

const emitToUser = (userId, event, payload) => {
  io.to(String(userId)).emit(event, payload);
};

const getCallForUser = (callId, userId) => {
  const call = activeCalls.get(String(callId));

  if (!call) return null;

  if (
    call.callerId !== String(userId) &&
    call.receiverId !== String(userId)
  ) {
    return null;
  }

  return call;
};

const isUserBusy = (userId) => {
  return Array.from(activeCalls.values()).some(
    (call) =>
      call.callerId === String(userId) ||
      call.receiverId === String(userId)
  );
};

const finishCallInDatabase = async (
  call,
  status,
  reason
) => {
  const endedAt = new Date();

  const answeredAt = call.answeredAt
    ? new Date(call.answeredAt)
    : null;

  const durationSeconds = answeredAt
    ? Math.max(
        0,
        Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000)
      )
    : 0;

  return Call.findOneAndUpdate(
    {
      callId: call.callId,
      status: { $in: ["ringing", "accepted"] },
    },
    {
      $set: {
        status,
        endedAt,
        durationSeconds,
        endReason: reason,
      },
    },
    { new: true }
  );
};

// =====================================
// AUTHENTICATED SOCKET CONNECTION
// =====================================

io.on("connection", async (socket) => {
  const userId = socket.userId;

  // Cancel pending disconnect cleanup if the user reconnects.
  const pendingDisconnect = disconnectTimers.get(userId);
  if (pendingDisconnect) {
    clearTimeout(pendingDisconnect);
    disconnectTimers.delete(userId);
    console.log("User reconnected within grace period:", userId);
  }

  console.log("User connected:", userId);

  socket.join(userId);

  const userSockets = onlineUsers.get(userId) || new Set();

  userSockets.add(socket.id);
  onlineUsers.set(userId, userSockets);

  // =====================================
  // TYPING INDICATOR
  // =====================================

  socket.on("typing", ({ receiverId } = {}) => {
    if (!receiverId || String(receiverId) === userId) return;

    emitToUser(receiverId, "user_typing", {
      senderId: userId,
    });
  });

  socket.on("stop_typing", ({ receiverId } = {}) => {
    if (!receiverId || String(receiverId) === userId) return;

    emitToUser(receiverId, "user_stop_typing", {
      senderId: userId,
    });
  });

  // =====================================
  // MESSAGE DELIVERED
  // =====================================

  socket.on("message_delivered", async ({ messageId } = {}) => {
    try {
      if (!messageId) return;

      const deliveredMessage = await Message.findOneAndUpdate(
        {
          _id: messageId,
          receiver: userId,
          isDelivered: false,
        },
        {
          $set: {
            isDelivered: true,
            deliveredAt: new Date(),
          },
        },
        { new: true }
      );

      if (deliveredMessage) {
        emitToUser(String(deliveredMessage.sender), "message_status", {
          messageId: String(deliveredMessage._id),
          status: "delivered",
          deliveredAt: deliveredMessage.deliveredAt,
        });
      }
    } catch (error) {
      console.error("Message delivery update error:", error);
    }
  });

  // =====================================
  // MESSAGE SEEN
  // =====================================

  socket.on("messages_seen", async ({ senderId } = {}) => {
    try {
      if (!senderId || String(senderId) === userId) return;

      const seenMessages = await Message.updateMany(
        {
          sender: senderId,
          receiver: userId,
          isSeen: false,
        },
        {
          $set: {
            isSeen: true,
            seenAt: new Date(),
            isDelivered: true,
            deliveredAt: new Date(),
          },
        }
      );

      if (seenMessages.modifiedCount > 0) {
        emitToUser(String(senderId), "messages_seen", {
          senderId: userId,
        });
      }
    } catch (error) {
      console.error("Messages seen update error:", error);
    }
  });

  // =====================================
  // VOICE / VIDEO CALL SIGNALING
  // =====================================

  // CALL INVITE
  // Backend generates callId.
  socket.on("call:invite", async ({ to, callType } = {}, callback) => {
    let callId;

    try {
      const receiverId = String(to || "");
      const type = callType === "video" ? "video" : "audio";

      if (!receiverId || receiverId === "undefined") {
        return callback?.({
          ok: false,
          message: "Invalid receiver",
        });
      }

      if (receiverId === userId) {
        return callback?.({
          ok: false,
          message: "You cannot call yourself",
        });
      }

      // Validate receiver exists.
      const receiverExists = await User.exists({ _id: receiverId });

      if (!receiverExists) {
        return callback?.({
          ok: false,
          message: "User not found",
        });
      }

      // Generate ID on backend.
      callId = randomUUID();

      // Create call history record first.
      await Call.create({
        callId,
        caller: userId,
        receiver: receiverId,
        callType: type,
        status: "ringing",
        startedAt: new Date(),
      });

      // Receiver offline.
      if (!onlineUsers.has(receiverId)) {
        await Call.findOneAndUpdate(
          { callId },
          {
            $set: {
              status: "missed",
              endedAt: new Date(),
              endReason: "receiver_offline",
            },
          }
        );

        return callback?.({
          ok: false,
          callId,
          message: "User is offline",
        });
      }

      // Caller or receiver already busy.
      if (isUserBusy(userId) || isUserBusy(receiverId)) {
        await Call.findOneAndUpdate(
          { callId },
          {
            $set: {
              status: "rejected",
              endedAt: new Date(),
              endReason: "user_busy",
            },
          }
        );

        return callback?.({
          ok: false,
          callId,
          message: "User is busy",
        });
      }

      const activeCall = {
        callId,
        callerId: userId,
        receiverId,
        callType: type,
        status: "ringing",
        createdAt: Date.now(),
        answeredAt: null,
      };

      activeCalls.set(callId, activeCall);

      emitToUser(receiverId, "call:incoming", {
        callId,
        from: userId,
        callType: type,
      });

      callback?.({
        ok: true,
        callId,
      });
    } catch (error) {
      console.error("Call invite error:", error);

      if (callId) {
        try {
          await Call.findOneAndUpdate(
            { callId },
            {
              $set: {
                status: "failed",
                endedAt: new Date(),
                endReason: "invite_error",
              },
            }
          );
        } catch (dbError) {
          console.error("Call failure history error:", dbError);
        }
      }

      callback?.({
        ok: false,
        message: "Unable to start call",
      });
    }
  });

  // =====================================
  // CALL ACCEPT
  // =====================================

  socket.on("call:accept", async ({ callId } = {}, callback) => {
    try {
      const call = getCallForUser(callId, userId);

      if (!call || call.receiverId !== userId || call.status !== "ringing") {
        return callback?.({
          ok: false,
          message: "Call not found",
        });
      }

      const updatedCall = await Call.findOneAndUpdate(
        {
          callId: call.callId,
          status: "ringing",
        },
        {
          $set: {
            status: "accepted",
          },
        },
        { new: true }
      );

      if (!updatedCall) {
        return callback?.({
          ok: false,
          message: "Call is no longer available",
        });
      }

      // Connection time is recorded later,
      // only after WebRTC is actually connected.
      call.status = "accepted";
      call.answeredAt = null;

      emitToUser(call.callerId, "call:accepted", {
        callId: call.callId,
        from: userId,
      });

      callback?.({ ok: true });
    } catch (error) {
      console.error("Call accept error:", error);

      callback?.({
        ok: false,
        message: "Unable to accept call",
      });
    }
  });


  // =====================================
  // CALL CONNECTED - ACTUAL WEBRTC CONNECTION
  // =====================================

  socket.on("call:connected", async ({ callId } = {}, callback) => {
    try {
      const call = getCallForUser(callId, userId);

      if (!call || call.status !== "accepted") {
        return callback?.({
          ok: false,
          message: "Call is not accepted",
        });
      }

      // Save the first successful connection time only once.
      if (!call.answeredAt) {
        const connectedAt = new Date();

        const updatedCall = await Call.findOneAndUpdate(
          {
            callId: call.callId,
            status: "accepted",
            answeredAt: null,
          },
          {
            $set: {
              answeredAt: connectedAt,
            },
          },
          { new: true }
        );

        if (updatedCall) {
          call.answeredAt = updatedCall.answeredAt;
        } else {
          // Another participant may have reported connection first.
          const existingCall = await Call.findOne({
            callId: call.callId,
          }).select("answeredAt");

          if (!existingCall?.answeredAt) {
            return callback?.({
              ok: false,
              message: "Could not save connection time",
            });
          }

          call.answeredAt = existingCall.answeredAt;
        }
      }

      const payload = {
        callId: call.callId,
        connectedAt: call.answeredAt,
      };

      emitToUser(call.callerId, "call:connected", payload);
      emitToUser(call.receiverId, "call:connected", payload);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Call connected error:", error);

      callback?.({
        ok: false,
        message: "Unable to update call connection",
      });
    }
  });


  // =====================================
  // CALL REJECT
  // =====================================

  socket.on("call:reject", async ({ callId } = {}, callback) => {
    try {
      const call = getCallForUser(callId, userId);

      if (!call || call.receiverId !== userId) {
        return callback?.({
          ok: false,
          message: "Call not found",
        });
      }

      await finishCallInDatabase(
        call,
        "rejected",
        "receiver_rejected"
      );

      emitToUser(call.callerId, "call:rejected", {
        callId: call.callId,
        from: userId,
      });

      activeCalls.delete(call.callId);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Call reject error:", error);

      callback?.({
        ok: false,
        message: "Unable to reject call",
      });
    }
  });

  // =====================================
  // CALL END
  // =====================================

  socket.on("call:end", async ({ callId } = {}, callback) => {
    try {
      const call = getCallForUser(callId, userId);

      if (!call) {
        return callback?.({
          ok: false,
          message: "Call not found",
        });
      }

      const otherUserId =
        call.callerId === userId
          ? call.receiverId
          : call.callerId;

      const finalStatus =
        call.status === "ringing" ? "cancelled" : "ended";

      await finishCallInDatabase(
        call,
        finalStatus,
        "call_ended"
      );

      emitToUser(otherUserId, "call:ended", {
        callId: call.callId,
        from: userId,
      });

      activeCalls.delete(call.callId);

      callback?.({ ok: true });
    } catch (error) {
      console.error("Call end error:", error);

      callback?.({
        ok: false,
        message: "Unable to end call",
      });
    }
  });

  // =====================================
  // WEBRTC OFFER
  // =====================================

  socket.on("webrtc:offer", ({ callId, description } = {}) => {
    const call = getCallForUser(callId, userId);

    if (!call || call.status !== "accepted" || !description) return;

    const receiverId =
      call.callerId === userId
        ? call.receiverId
        : call.callerId;

    emitToUser(receiverId, "webrtc:offer", {
      callId: call.callId,
      from: userId,
      description,
    });
  });

  // =====================================
  // WEBRTC ANSWER
  // =====================================

  socket.on("webrtc:answer", ({ callId, description } = {}) => {
    const call = getCallForUser(callId, userId);

    if (!call || call.status !== "accepted" || !description) return;

    const receiverId =
      call.callerId === userId
        ? call.receiverId
        : call.callerId;

    emitToUser(receiverId, "webrtc:answer", {
      callId: call.callId,
      from: userId,
      description,
    });
  });

  // =====================================
  // WEBRTC ICE CANDIDATE
  // =====================================

  socket.on(
    "webrtc:ice-candidate",
    ({ callId, candidate } = {}) => {
      const call = getCallForUser(callId, userId);

      if (!call || !candidate) return;

      const receiverId =
        call.callerId === userId
          ? call.receiverId
          : call.callerId;

      emitToUser(receiverId, "webrtc:ice-candidate", {
        callId: call.callId,
        from: userId,
        candidate,
      });
    }
  );

  // =====================================
  // USER ONLINE STATUS
  // =====================================

  try {
    await User.findByIdAndUpdate(userId, {
      isOnline: true,
    });

    io.emit("user_status", {
      userId,
      isOnline: true,
    });

    socket.emit("online_users", Array.from(onlineUsers.keys()));
  } catch (error) {
    console.error("Online status update error:", error);
  }

  // =====================================
  // DISCONNECT
  // =====================================

  socket.on("disconnect", () => {
    console.log("User disconnected:", userId);

    const activeSockets = onlineUsers.get(userId);

    if (activeSockets) {
      activeSockets.delete(socket.id);

      // Another tab/device is still connected.
      if (activeSockets.size > 0) return;

      onlineUsers.delete(userId);
    }

    // Give the user 20 seconds to reconnect before ending active calls.
    const timer = setTimeout(async () => {
      disconnectTimers.delete(userId);

      // A new socket may have connected during the grace period.
      if (onlineUsers.has(userId)) return;

      for (const [callId, call] of activeCalls.entries()) {
        if (
          call.callerId !== userId &&
          call.receiverId !== userId
        ) {
          continue;
        }

        const otherUserId =
          call.callerId === userId
            ? call.receiverId
            : call.callerId;

        try {
          const finalStatus =
            call.status === "ringing" ? "missed" : "ended";

          await finishCallInDatabase(
            call,
            finalStatus,
            "disconnected"
          );
        } catch (error) {
          console.error("Disconnected call history error:", error);
        }

        emitToUser(otherUserId, "call:ended", {
          callId,
          from: userId,
          reason: "disconnected",
        });

        activeCalls.delete(callId);
      }

      try {
        const lastSeen = new Date();

        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen,
        });

        io.emit("user_status", {
          userId,
          isOnline: false,
          lastSeen,
        });
      } catch (error) {
        console.error("Offline status update error:", error);
      }
    }, 20000);

    disconnectTimers.set(userId, timer);
  });
});

// =====================================
// START SERVER
// =====================================

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    httpServer.listen(PORT, () => {
      console.log(`Connectify Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup error:", error);
    process.exit(1);
  }
};

startServer();
