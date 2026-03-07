const express = require("express");
const router = express.Router();
const { Expense, mapExpense, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { parseFinancialYear, getFinancialYearFromDate } = require("../utils/financialYear");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function bodyToExpense(body, userId) {
  const row = {
    user_id: userId,
    crop_id: body.cropId,
    category: body.category,
    date: body.date ?? new Date(),
    notes: body.notes ?? "",
    seed: body.seed ?? null,
    fertilizer: body.fertilizer ?? null,
    pesticide: body.pesticide ?? null,
    labour_daily: body.labourDaily ?? null,
    labour_contract: body.labourContract ?? null,
    machinery: body.machinery ?? null,
    irrigation: body.irrigation ?? null,
    other: body.other ?? null,
  };
  return row;
}

router.post(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { cropId, category, date, notes, seed, fertilizer, pesticide, labourDaily, labourContract, machinery, irrigation, other } = req.body;
    if (!cropId || !category) {
      return res.status(400).json({ success: false, message: "cropId and category are required." });
    }
    const VALID_CATEGORIES = ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery", "Irrigation", "Other"];
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    const expense = await Expense.create(bodyToExpense(req.body, req.user.id));
    res.status(201).json({ success: true, data: mapExpense(expense) });
  })
);

router.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { cropId, category, year, financialYear, page = 1, limit = 20 } = req.query;
    const where = { user_id: req.user.id };
    if (cropId) where.crop_id = cropId;
    if (category) where.category = category;
    const fy = financialYear || (year && String(year).includes("-") ? year : null);
    if (fy) {
      const range = parseFinancialYear(fy);
      if (range) {
        where.date = { [Op.gte]: range.startDate, [Op.lte]: range.endDate };
      }
    } else if (year) {
      where.year = Number(year);
    }

    const { count, rows } = await Expense.findAndCountAll({
      where,
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });
    res.json({
      success: true,
      data: rows.map(mapExpense),
      pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / Number(limit)) },
    });
  })
);

router.get(
  "/summary",
  auth,
  asyncHandler(async (req, res) => {
    const { year, financialYear, cropId } = req.query;
    const where = { user_id: req.user.id };
    const fy = financialYear || (year && String(year).includes("-") ? year : null);
    if (fy) {
      const range = parseFinancialYear(fy);
      if (range) where.date = { [Op.gte]: range.startDate, [Op.lte]: range.endDate };
    } else if (year) {
      where.year = Number(year);
    }
    if (cropId) where.crop_id = cropId;

    const rows = await Expense.findAll({
      attributes: ["category", [sequelize.fn("SUM", sequelize.col("amount")), "total"], [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where,
      group: ["category"],
      raw: true,
    });
    const summary = rows.map((r) => ({ _id: r.category, total: parseFloat(r.total) || 0, count: parseInt(r.count, 10) }));
    summary.sort((a, b) => b.total - a.total);
    const grandTotal = summary.reduce((acc, s) => acc + (s.total || 0), 0);
    res.json({ success: true, year: fy || year || "all", financialYear: fy || null, summary, grandTotal });
  })
);

router.get(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found." });
    res.json({ success: true, data: mapExpense(expense) });
  })
);

router.delete(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found." });
    await expense.destroy();
    res.json({ success: true, message: "Expense deleted successfully." });
  })
);

module.exports = router;
