const mongoose = require("mongoose");

// ─────────────────────────────────────────────────────────────────────────────
// FarmerProfile Schema
//
// STORAGE STRATEGY: Store English keys, display Gujarati labels in the UI.
//
//   DB stores:   district: "Jamnagar"    taluka: "Kalavad"    village: "Khijadia"
//   UI shows:    "જામનગર"               "કાળાવડ"             "ખીજડીયા"
//
// The frontend gujarat-locations.ts data file handles the key→label lookup.
// This means:
//   ✅ DB stays clean with ASCII English keys (easy to query, index, filter)
//   ✅ UI can switch language freely without touching the database
//   ✅ No unicode encoding issues in queries or analytics
//   ✅ Enums work reliably for validation
// ─────────────────────────────────────────────────────────────────────────────

const farmerProfileSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            unique: true,
        },

        // ── Personal ───────────────────────────────────────────────────────
        name: {
            type: String,
            required: true,
            trim: true,
            // Stored as typed by user (English or Gujarati).
            // If you want guaranteed Gujarati: transliterate in controller before saving.
        },

        // ── Location (English keys — Gujarati shown in UI via lookup) ──────
        district: {
            type: String,
            enum: [
                "Rajkot",
                "Jamnagar",
                "Junagadh",
                "Amreli",
                "Morbi",
                "Bhavnagar",
                "Surendranagar",
                "Other",
            ],
            required: true,
            // DB stores "Jamnagar" → UI shows "જામનગર"
        },

        taluka: {
            type: String,
            required: true,
            trim: true,
            // DB stores "Kalavad" → UI shows "કાળાવડ"
            // Not enum'd here since talukas are district-dependent and extensive.
            // Validation happens on the frontend via the location data file.
        },

        village: {
            type: String,
            required: true,
            trim: true,
            // DB stores "Khijadia" → UI shows "ખીજડીયા"
        },

        // ── Land ──────────────────────────────────────────────────────────
        totalLand: {
            value: { type: Number, required: true, min: 0 },
            unit: {
                type: String,
                enum: ["acre", "bigha"],
                default: "acre",
            },
        },

        // ── Farming Resources (English enum keys) ─────────────────────────
        waterSource: {
            type: String,
            enum: ["Rain", "Borewell", "Canal"],
            required: true,
            // DB stores "Rain" → UI shows "🌧 વરસાદ"
        },

        tractorAvailable: {
            type: Boolean,
            required: true,
        },

        labourType: {
            type: String,
            enum: ["Family", "Hired", "Mixed"],
            required: true,
            // DB stores "Family" → UI shows "👨‍👩‍👧 પારિવારિક"
        },

        // ── Privacy ───────────────────────────────────────────────────────
        analyticsConsent: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// ── Indexes for efficient location-based queries ──────────────────────────────
farmerProfileSchema.index({ district: 1 });
farmerProfileSchema.index({ district: 1, taluka: 1 });
farmerProfileSchema.index({ district: 1, taluka: 1, village: 1 });

module.exports = mongoose.model("FarmerProfile", farmerProfileSchema);

// ─────────────────────────────────────────────────────────────────────────────
// USAGE EXAMPLES
//
// Query by district (English key, fast):
//   FarmerProfile.find({ district: "Jamnagar" })
//
// Query by taluka:
//   FarmerProfile.find({ district: "Jamnagar", taluka: "Kalavad" })
//
// Group by district for analytics:
//   FarmerProfile.aggregate([{ $group: { _id: "$district", count: { $sum: 1 } } }])
//
// The frontend converts the English keys back to Gujarati at render time
// using the getLocationLabel() helper from gujarat-locations.ts.
// ─────────────────────────────────────────────────────────────────────────────