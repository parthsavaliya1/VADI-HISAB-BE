const express = require("express");
const router = express.Router();
const Crop = require("../models/Crop");
// const auth    = require("../middleware/auth"); // uncomment if you have JWT middleware

// ─── Helper ───────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/crops  — Create a new crop
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  // auth,   // protect route
  asyncHandler(async (req, res) => {
    const { season, cropName, cropEmoji, area, areaUnit, status, notes } =
      req.body;

    console.log("Creating crop with data:", req.body); // Debug log

    // Basic validation
    if (!season || !cropName || !area) {
      return res.status(400).json({
        success: false,
        message: "season, cropName, and area are required.",
      });
    }

    const crop = await Crop.create({
      userId: req.user?._id ?? req.body.userId, // use req.user._id when auth is enabled
      season,
      cropName,
      cropEmoji: cropEmoji ?? "🌱",
      area: Number(area),
      areaUnit: areaUnit ?? "Bigha",
      status: status ?? "Active",
      notes: notes ?? "",
    });

    res.status(201).json({ success: true, data: crop });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crops  — Get all crops (optionally filter by season / status)
// Query params: ?season=kharif  ?status=Active  ?page=1  ?limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  // auth,
  asyncHandler(async (req, res) => {
    const { season, status, page = 1, limit = 20 } = req.query;

    const filter = {
      // userId: req.user._id,  // uncomment when auth is enabled
    };
    if (season) filter.season = season;
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Crop.countDocuments(filter);
    const crops = await Crop.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      data: crops,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crops/:id  — Get a single crop by ID
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  // auth,
  asyncHandler(async (req, res) => {
    const crop = await Crop.findById(req.params.id);

    if (!crop) {
      return res
        .status(404)
        .json({ success: false, message: "Crop not found." });
    }

    // Optional ownership check:
    // if (crop.userId.toString() !== req.user._id.toString()) {
    //     return res.status(403).json({ success: false, message: "Not authorized." });
    // }

    res.json({ success: true, data: crop });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/crops/:id  — Update a crop (full or partial)
// ─────────────────────────────────────────────────────────────────────────────
router.put(
  "/:id",
  // auth,
  asyncHandler(async (req, res) => {
    const allowed = [
      "season",
      "cropName",
      "cropEmoji",
      "area",
      "areaUnit",
      "status",
      "notes",
    ];
    const updates = {};
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    });

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No valid fields to update." });
    }

    const crop = await Crop.findByIdAndUpdate(
      req.params.id,
      { $set: updates },
      { new: true, runValidators: true },
    );

    if (!crop) {
      return res
        .status(404)
        .json({ success: false, message: "Crop not found." });
    }

    res.json({ success: true, data: crop });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/crops/:id/status  — Update status only (quick action)
// Body: { "status": "Harvested" }
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/status",
  // auth,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const valid = ["Active", "Harvested", "Closed"];

    if (!valid.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Status must be one of: ${valid.join(", ")}`,
      });
    }

    const crop = await Crop.findByIdAndUpdate(
      req.params.id,
      { $set: { status } },
      { new: true },
    );

    if (!crop) {
      return res
        .status(404)
        .json({ success: false, message: "Crop not found." });
    }

    res.json({ success: true, data: crop });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/crops/:id  — Delete a crop
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  // auth,
  asyncHandler(async (req, res) => {
    const crop = await Crop.findByIdAndDelete(req.params.id);

    if (!crop) {
      return res
        .status(404)
        .json({ success: false, message: "Crop not found." });
    }

    res.json({ success: true, message: "Crop deleted successfully." });
  }),
);

module.exports = router;
