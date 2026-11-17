const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],

    pairKey: {
      type: String,
      required: true,
      unique: true,
    },

    hiddenFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],

    lastMessageHiddenFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],

    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participants: 1 });

module.exports = mongoose.model("Conversation", conversationSchema);
