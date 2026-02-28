const express = require("express");
const router = express.Router();
const Income = require("../models/Income");

// ─── Helper: build year filter ────────────────────────────────────────────────
// ?year=2024  →  { $gte: 2024-01-01, $lt: 2025-01-01 }
function yearFilter(queryYear) {
  if (!queryYear) return {};
  const year = parseInt(queryYear, 10);
  if (isNaN(year)) return {};
  return {
    date: {
      $gte: new Date(`${year}-01-01T00:00:00.000Z`),
      $lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
    },
  };
}

// ─── GET /api/income ──────────────────────────────────────────────────────────
// Query params: year, category, cropId, page, limit
router.get("/", async (req, res) => {
  try {
    const { year, category, cropId, page = 1, limit = 20 } = req.query;

    const filter = {
      ...yearFilter(year),
      ...(category ? { category } : {}),
      ...(cropId ? { cropId } : {}),
    };

    const [incomes, total] = await Promise.all([
      Income.find(filter)
        .sort({ date: -1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Income.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: incomes,
      pagination: { total, page: Number(page), limit: Number(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/income/summary ──────────────────────────────────────────────────
// Returns total income grouped by category for a given year
// Query params: year (required)
router.get("/summary", async (req, res) => {
  try {
    const { year } = req.query;

    const matchStage = { $match: yearFilter(year) };

    const summary = await Income.aggregate([
      matchStage,
      {
        $group: {
          _id: "$category",
          totalAmount: {
            $sum: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ["$category", "Crop Sale"] },
                    then: "$cropSale.totalAmount",
                  },
                  {
                    case: { $eq: ["$category", "Subsidy"] },
                    then: "$subsidy.amount",
                  },
                  {
                    case: { $eq: ["$category", "Rental Income"] },
                    then: "$rentalIncome.totalAmount",
                  },
                  {
                    case: { $eq: ["$category", "Other"] },
                    then: "$otherIncome.amount",
                  },
                ],
                default: 0,
              },
            },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    // Grand total
    const grandTotal = summary.reduce(
      (acc, s) => acc + (s.totalAmount || 0),
      0,
    );

    res.json({ success: true, year: year || "all", summary, grandTotal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/income/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const income = await Income.findById(req.params.id);
    if (!income)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: income });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/income ─────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const income = new Income(req.body);
    await income.save();
    res.status(201).json({ success: true, data: income });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── PUT /api/income/:id ──────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    // We use findById + save so pre-save hooks (derived fields) run
    const income = await Income.findById(req.params.id);
    if (!income)
      return res.status(404).json({ success: false, message: "Not found" });

    Object.assign(income, req.body);
    await income.save();

    res.json({ success: true, data: income });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/income/:id ───────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const income = await Income.findByIdAndDelete(req.params.id);
    if (!income)
      return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
