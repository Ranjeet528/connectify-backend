const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const Message = require("../models/Message");

exports.createOrGetConversation = async (req, res) => {
  try {
    const { userId } = req.body;
    const currentUserId = String(req.user._id);

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Valid user ID is required",
      });
    }

    if (String(userId) === currentUserId) {
      return res.status(400).json({
        success: false,
        message: "You cannot start a chat with yourself",
      });
    }

    const otherUser = await User.findById(userId).select("_id");

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const participants = [currentUserId, String(userId)].sort();
    const pairKey = participants.join("_");

    const conversation = await Conversation.findOneAndUpdate(
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
    ).populate("participants", "name email avatar about isOnline lastSeen");

    return res.status(200).json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to start conversation",
    });
  }
};

exports.getConversations = async (req, res) => {
  try {
    const currentUserId = String(req.user._id);

    const conversations = await Conversation.find({
      participants: req.user._id,
      hiddenFor: { $ne: req.user._id },
    })
      .populate("participants", "name email avatar about isOnline lastSeen")
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .lean();

    const visibleConversations = await Promise.all(
      conversations.map(async (conversation) => {
        const otherUser = conversation.participants.find(
          (participant) => String(participant._id) !== currentUserId
        );

        let lastMessage = null;

        if (otherUser) {
          lastMessage = await Message.findOne({
            $or: [
              { sender: currentUserId, receiver: otherUser._id },
              { sender: otherUser._id, receiver: currentUserId },
            ],
            hiddenFor: { $ne: currentUserId },
          })
            .sort({ createdAt: -1 })
            .lean();
        }

        return {
          ...conversation,
          lastMessage,
          lastMessageAt: lastMessage ? lastMessage.createdAt : null,
        };
      })
    );

    visibleConversations.sort(
      (a, b) =>
        new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0)
    );

    return res.status(200).json({
      success: true,
      count: visibleConversations.length,
      conversations: visibleConversations,
    });
  } catch (error) {
    console.error("Get conversations error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to fetch conversations",
    });
  }
};


exports.deleteConversation = async (req, res) => {
  try {
    const currentUserId = String(req.user._id);
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId) || userId === currentUserId) {
      return res.status(400).json({ success: false, message: "Invalid user ID" });
    }

    const pairKey = [currentUserId, String(userId)].sort().join("_");

    const result = await Conversation.updateOne(
      { pairKey, participants: currentUserId },
      { $addToSet: { hiddenFor: currentUserId } }
    );

    return res.status(200).json({
      success: true,
      message: "Chat removed from your chat list",
    });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete conversation",
    });
  }
};
