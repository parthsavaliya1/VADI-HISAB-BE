const mongoose = require("mongoose");

const CropSchema = new mongoose.Schema(
  {
    // ── Owner ──────────────────────────────────────────────────────────────
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ── Season ────────────────────────────────────────────────────────────
    season: {
      type: String,
      enum: ["Kharif", "Rabi", "Summer"],
    },

    // ── Crop details ──────────────────────────────────────────────────────
    cropName: {
      type: String,
      required: [true, "Crop name is required"],
      trim: true,
      maxlength: [100, "Crop name cannot exceed 100 characters"],
    },
    cropEmoji: {
      type: String,
      default: "🌱",
    },

    // ── Land ──────────────────────────────────────────────────────────────
    area: {
      type: Number,
      required: [true, "Area is required"],
      min: [0.01, "Area must be greater than 0"],
    },
    areaUnit: {
      type: String,
      enum: ["Bigha", "Acre", "Hectare"],
      default: "Bigha",
    },

    // ── Status ────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["Active", "Harvested", "Closed"],
      default: "Active",
    },

    // ── Extra ─────────────────────────────────────────────────────────────
    notes: {
      type: String,
      trim: true,
      maxlength: [500, "Notes cannot exceed 500 characters"],
      default: "",
    },
  },
  {
    timestamps: true, // adds createdAt & updatedAt automatically
    toJSON: { virtuals: true },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
CropSchema.index({ userId: 1, season: 1 });
CropSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model("Crop", CropSchema);
