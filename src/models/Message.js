
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    text: {
      type: String,
      trim: true,
      default: "",
    },

    messageType: {
      type: String,
      enum: ["text", "image", "video", "audio", "file"],
      default: "text",
    },

    mediaUrl: {
      type: String,
      default: "",
    },

    publicId: {
      type: String,
      default: "",
    },

    fileName: {
      type: String,
      default: "",
    },

    fileSize: {
      type: Number,
      default: 0,
    },

    mimeType: {
      type: String,
      default: "",
    },

    hiddenFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],

    isDelivered: {
      type: Boolean,
      default: false,
    },

    deliveredAt: {
      type: Date,
      default: null,
    },

    isSeen: {
      type: Boolean,
      default: false,
    },

    seenAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

messageSchema.index({
  sender: 1,
  receiver: 1,
  createdAt: -1,
});

messageSchema.index({
  receiver: 1,
  sender: 1,
  createdAt: -1,
});

const Message = mongoose.model("Message", messageSchema);

module.exports = Message;
