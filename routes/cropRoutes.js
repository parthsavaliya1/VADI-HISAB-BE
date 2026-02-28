const express = require("express");
const router = express.Router();
const Crop = require("../models/Crop");
// const auth = require("../middleware/auth"); // uncomment if you have JWT middleware

// ─── Helper ───────────────────────────────────────────────────────────────────
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/crops  — Create a new crop
// Body: { season, cropName, cropEmoji, subType, batchLabel, year,
//         area, areaUnit, sowingDate, harvestDate, status, notes, userId }
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  // auth,
  asyncHandler(async (req, res) => {
    const {
      season,
      cropName,
      cropEmoji,
      subType,
      batchLabel,
      year,
      area,
      areaUnit,
      sowingDate,
      harvestDate,
      status,
      notes,
    } = req.body;

    console.log("Creating crop with data:", req.body);

    // Basic validation
    if (!season || !cropName || !area) {
      return res.status(400).json({
        success: false,
        message: "season, cropName, and area are required.",
      });
    }

    const crop = await Crop.create({
      userId: req.user?._id ?? req.body.userId,
      season,
      cropName,
      cropEmoji: cropEmoji ?? "🌱",
      subType: subType ?? "",
      batchLabel: batchLabel ?? "",
      year: year ?? new Date().getFullYear(),
      area: Number(area),
      areaUnit: areaUnit ?? "Bigha",
      sowingDate: sowingDate ?? null,
      harvestDate: harvestDate ?? null,
      status: status ?? "Active",
      notes: notes ?? "",
    });

    res.status(201).json({ success: true, data: crop });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crops/report/years  — Which years have crop data for this user
// Query: ?userId=xxx  (use req.user._id when auth is enabled)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/report/years",
  // auth,
  asyncHandler(async (req, res) => {
    const userId = req.user?._id ?? req.query.userId;

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required." });
    }

    const years = await Crop.distinct("year", { userId });

    res.json({
      success: true,
      years: years.sort((a, b) => b - a), // newest first
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crops/report/yearly  — Full yearly report for a user
// Query: ?year=2025 &userId=xxx
//
// Returns:
//   { year, crops: [...with income/expense/profit], summary: { totals } }
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/report/yearly",
  // auth,
  asyncHandler(async (req, res) => {
    const userId = req.user?._id ?? req.query.userId;
    const year = Number(req.query.year) || new Date().getFullYear();

    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "userId is required." });
    }

    // ── All crops for this user + year ──
    const crops = await Crop.find({ userId, year }).sort({ createdAt: -1 });

    if (!crops.length) {
      return res.json({
        success: true,
        year,
        crops: [],
        summary: {
          totalIncome: 0,
          totalExpense: 0,
          netProfit: 0,
          totalCrops: 0,
          totalArea: 0,
        },
      });
    }

    const cropIds = crops.map((c) => c._id);

    // ── Aggregate financials from Expense model ──
    // Assumes Expense schema has: { cropId, type: "income"|"expense", amount }
    let financialMap = {};
    try {
      const Expense = require("../models/Expense");

      const aggregated = await Expense.aggregate([
        { $match: { cropId: { $in: cropIds } } },
        {
          $group: {
            _id: { cropId: "$cropId", type: "$type" },
            total: { $sum: "$amount" },
          },
        },
      ]);

      aggregated.forEach(({ _id, total }) => {
        const id = _id.cropId.toString();
        if (!financialMap[id]) financialMap[id] = { income: 0, expense: 0 };
        financialMap[id][_id.type] = total;
      });
    } catch (e) {
      // Expense model may not exist yet — gracefully continue with zeros
      console.warn(
        "Expense model not found, financials will be zero:",
        e.message,
      );
    }

    // ── Build per-crop report ──
    let totalIncome = 0;
    let totalExpense = 0;
    let totalArea = 0;

    const cropReports = crops.map((crop) => {
      const id = crop._id.toString();
      const income = financialMap[id]?.income ?? 0;
      const expense = financialMap[id]?.expense ?? 0;
      const profit = income - expense;

      totalIncome += income;
      totalExpense += expense;
      totalArea += crop.area ?? 0;

      return {
        _id: crop._id,
        cropName: crop.cropName,
        cropEmoji: crop.cropEmoji,
        subType: crop.subType,
        batchLabel: crop.batchLabel,
        season: crop.season,
        year: crop.year,
        area: crop.area,
        areaUnit: crop.areaUnit,
        status: crop.status,
        sowingDate: crop.sowingDate,
        harvestDate: crop.harvestDate,
        notes: crop.notes,
        income,
        expense,
        profit,
        createdAt: crop.createdAt,
      };
    });

    // ── Season-wise breakdown ──
    const seasonBreakdown = {};
    cropReports.forEach((c) => {
      const s = c.season;
      if (!seasonBreakdown[s]) {
        seasonBreakdown[s] = {
          income: 0,
          expense: 0,
          profit: 0,
          crops: 0,
          area: 0,
        };
      }
      seasonBreakdown[s].income += c.income;
      seasonBreakdown[s].expense += c.expense;
      seasonBreakdown[s].profit += c.profit;
      seasonBreakdown[s].crops += 1;
      seasonBreakdown[s].area += c.area;
    });

    res.json({
      success: true,
      year,
      crops: cropReports,
      seasonBreakdown,
      summary: {
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        totalCrops: crops.length,
        totalArea,
      },
    });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/crops  — Get all crops with filters
// Query: ?season=Kharif  ?status=Active  ?year=2025  ?page=1  ?limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  // auth,
  asyncHandler(async (req, res) => {
    const { season, status, year, page = 1, limit = 20 } = req.query;

    const filter = {
      // userId: req.user._id,  // uncomment when auth is enabled
    };
    if (season) filter.season = season;
    if (status) filter.status = status;
    if (year) filter.year = Number(year);

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
      "subType", // NEW
      "batchLabel", // NEW
      "year", // NEW
      "area",
      "areaUnit",
      "sowingDate", // NEW
      "harvestDate", // NEW
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
// PATCH /api/crops/:id/harvest  — Mark as harvested + set harvestDate
// Body: { "harvestDate": "2025-11-01" }  (optional, defaults to today)
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/:id/harvest",
  // auth,
  asyncHandler(async (req, res) => {
    const harvestDate = req.body.harvestDate
      ? new Date(req.body.harvestDate)
      : new Date();

    const crop = await Crop.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "Harvested", harvestDate } },
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
