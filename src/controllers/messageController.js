const mongoose = require("mongoose");
const Message = require("../models/Message");
const User = require("../models/User");
const Conversation = require("../models/Conversation");

const getPrivateConversation = async (currentUserId, otherUserId) => {
  const participants = [
    String(currentUserId),
    String(otherUserId),
  ].sort();

  const pairKey = participants.join("_");

  return Conversation.findOneAndUpdate(
    { pairKey },
    {
      $setOnInsert: {
        participants,
        pairKey,
        lastMessageAt: new Date(),
      },
      $pull: {
        hiddenFor: currentUserId,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  );
};

exports.getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = String(req.user._id);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    if (String(userId) === currentUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot open a conversation with yourself",
      });
    }

    const otherUser = await User.findById(userId).select("_id");

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    await getPrivateConversation(currentUserId, userId);

    const messages = await Message.find({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId },
      ],
      hiddenFor: { $ne: currentUserId },
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: messages.length,
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch messages",
    });
  }
};

exports.sendMessage = async (req, res) => {
  try {
    const {
      receiverId,
      text,
      messageType = "text",
      mediaUrl,
      publicId,
      fileName,
      fileSize,
      mimeType,
    } = req.body;

    const currentUserId = String(req.user._id);

    if (
      !receiverId ||
      !mongoose.Types.ObjectId.isValid(receiverId)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid receiver ID is required",
      });
    }

    if (String(receiverId) === currentUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot send a message to yourself",
      });
    }

    const allowedTypes = ["text", "image", "video", "audio", "file"];

    if (!allowedTypes.includes(messageType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid message type",
      });
    }

    const cleanText = typeof text === "string" ? text.trim() : "";

    if (messageType === "text" && !cleanText) {
      return res.status(400).json({
        success: false,
        message: "Message text is required",
      });
    }

    if (messageType !== "text") {
      if (
        typeof mediaUrl !== "string" ||
        !/^https?:\/\//i.test(mediaUrl)
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid media URL is required",
        });
      }
    }

    const receiver = await User.findById(receiverId).select("_id");

    if (!receiver) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
      });
    }

    const conversation = await getPrivateConversation(
      currentUserId,
      receiverId
    );

    const newMessage = await Message.create({
      sender: currentUserId,
      receiver: receiverId,
      text: cleanText,
      messageType,
      mediaUrl: mediaUrl || "",
      publicId: publicId || "",
      fileName: fileName || "",
      fileSize:
        Number.isFinite(Number(fileSize)) && Number(fileSize) >= 0
          ? Number(fileSize)
          : 0,
      mimeType: mimeType || "",
    });

    await Conversation.findByIdAndUpdate(conversation._id, {
      $set: {
        lastMessage: newMessage._id,
        lastMessageAt: newMessage.createdAt,
      },
      $pull: {
        lastMessageHiddenFor: {
          $in: [String(currentUserId), String(receiverId)],
        },
      },
    });

    const io = req.app.get("io");

    if (io) {
      io.to(String(receiverId)).emit("receive_message", newMessage);
    }

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: newMessage,
    });
  } catch (error) {
    console.error("Send message error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to send message",
    });
  }
};


exports.clearChat = async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || userId === currentUserId) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    await Message.updateMany(
      {
        $or: [
          { sender: currentUserId, receiver: userId },
          { sender: userId, receiver: currentUserId },
        ],
        hiddenFor: { $ne: currentUserId },
      },
      { $addToSet: { hiddenFor: currentUserId } }
    );

    const pairKey = [currentUserId, userId].sort().join("_");

    await Conversation.updateOne(
      { pairKey },
      { $addToSet: { lastMessageHiddenFor: currentUserId } }
    );

    return res.status(200).json({
      success: true,
      message: "Chat cleared successfully",
    });
  } catch (error) {
    console.error("Clear chat error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to clear chat",
    });
  }
};
