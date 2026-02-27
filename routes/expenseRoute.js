const express = require("express");
const router = express.Router();
const Expense = require("../models/Expense");
// const auth = require("../middleware/auth"); // uncomment when auth is live

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/expenses  — Create a new expense
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/",
  // auth,
  asyncHandler(async (req, res) => {
    const {
      cropId,
      category,
      date,
      notes,
      seed,
      fertilizer,
      pesticide,
      labourDaily,
      labourContract,
      machinery,
    } = req.body;

    console.log("Creating expense:", req.body);

    if (!cropId || !category) {
      return res.status(400).json({
        success: false,
        message: "cropId and category are required.",
      });
    }

    const VALID_CATEGORIES = [
      "Seed",
      "Fertilizer",
      "Pesticide",
      "Labour",
      "Machinery",
    ];
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        success: false,
        message: `category must be one of: ${VALID_CATEGORIES.join(", ")}`,
      });
    }

    const expenseData = {
      userId: req.user?._id ?? req.body.userId,
      cropId,
      category,
      date: date ?? new Date(),
      notes: notes ?? "",
    };

    // Attach only the relevant sub-document
    if (category === "Seed" && seed) expenseData.seed = seed;
    if (category === "Fertilizer" && fertilizer)
      expenseData.fertilizer = fertilizer;
    if (category === "Pesticide" && pesticide)
      expenseData.pesticide = pesticide;
    if (category === "Labour") {
      if (labourDaily) expenseData.labourDaily = labourDaily;
      if (labourContract) expenseData.labourContract = labourContract;
    }
    if (category === "Machinery" && machinery)
      expenseData.machinery = machinery;

    const expense = await Expense.create(expenseData);
    res.status(201).json({ success: true, data: expense });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/expenses  — Get all expenses
// Query: ?cropId=xxx  ?category=Seed  ?page=1  ?limit=20
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/",
  // auth,
  asyncHandler(async (req, res) => {
    const { cropId, category, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (cropId) filter.cropId = cropId;
    if (category) filter.category = category;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Expense.countDocuments(filter);
    const expenses = await Expense.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      data: expenses,
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
// GET /api/expenses/:id  — Get single expense
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const expense = await Expense.findById(req.params.id);
    if (!expense)
      return res
        .status(404)
        .json({ success: false, message: "Expense not found." });
    res.json({ success: true, data: expense });
  }),
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/expenses/:id  — Delete expense
// ─────────────────────────────────────────────────────────────────────────────
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense)
      return res
        .status(404)
        .json({ success: false, message: "Expense not found." });
    res.json({ success: true, message: "Expense deleted successfully." });
  }),
);

module.exports = router;
