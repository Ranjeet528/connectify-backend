const mongoose = require("mongoose");

const callSchema = new mongoose.Schema(
  {
    hiddenFor: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],

    callId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    caller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    callType: {
      type: String,
      enum: ["audio", "video"],
      required: true,
    },

    status: {
      type: String,
      enum: [
        "ringing",
        "accepted",
        "rejected",
        "missed",
        "ended",
        "failed",
        "cancelled",
      ],
      default: "ringing",
      index: true,
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    answeredAt: {
      type: Date,
      default: null,
    },

    endedAt: {
      type: Date,
      default: null,
    },

    durationSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },

    endReason: {
      type: String,
      default: "",
      maxlength: 100,
    },
  },
  {
    timestamps: true,
  }
);

callSchema.index({ caller: 1, createdAt: -1 });
callSchema.index({ receiver: 1, createdAt: -1 });


const Call = mongoose.model("Call", callSchema);

module.exports = Call;
