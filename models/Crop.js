const mongoose = require("mongoose");

const CropSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ── Season & Year ─────────────────────────────────────────────────────
    season: {
      type: String,
      enum: ["Kharif", "Rabi", "Summer"],
    },
    year: {
      type: Number,
      required: true,
      default: () => new Date().getFullYear(),
      index: true,
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

    // ── Sub Type (NEW) ────────────────────────────────────────────────────
    // e.g. Garlic → "Desi", "Chinese", "Red"
    // e.g. Wheat → "GW-496", "GW-322"
    subType: {
      type: String,
      trim: true,
      maxlength: [100, "Sub type cannot exceed 100 characters"],
      default: "",
    },

    // ── Batch / Instance label (NEW) ──────────────────────────────────────
    // Allows same crop twice in one year: "Batch 1", "Field A", "ખેતર નં.2"
    batchLabel: {
      type: String,
      trim: true,
      maxlength: [50],
      default: "",
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

    // ── Dates (NEW) ───────────────────────────────────────────────────────
    sowingDate: {
      type: Date,
      default: null,
    },
    harvestDate: {
      type: Date,
      default: null,
    },

    // ── Status ────────────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["Active", "Harvested", "Closed"],
      default: "Active",
    },

    notes: {
      type: String,
      trim: true,
      maxlength: [500],
      default: "",
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
  },
);

// ── Indexes ───────────────────────────────────────────────────────────────────
CropSchema.index({ userId: 1, year: 1 });
CropSchema.index({ userId: 1, season: 1, year: 1 });
CropSchema.index({ userId: 1, status: 1 });
// Allows duplicate cropName in same year via different batchLabel
CropSchema.index({ userId: 1, cropName: 1, year: 1, batchLabel: 1 });

module.exports = mongoose.model("Crop", CropSchema);
