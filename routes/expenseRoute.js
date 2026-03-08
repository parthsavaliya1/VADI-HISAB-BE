const express = require("express");
const router = express.Router();
const { Expense, Crop, FarmerProfile, mapExpense, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { parseFinancialYear, getFinancialYearFromDate } = require("../utils/financialYear");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function bodyToExpense(body, userId) {
  const row = {
    user_id: userId,
    crop_id: body.cropId ?? null,
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
    if (!category) {
      return res.status(400).json({ success: false, message: "category is required." });
    }
    // cropId optional: null/omit for general expense (સામાન્ય ખર્ચ)
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
      const cropIdsForYear = await Crop.findAll({
        where: { user_id: req.user.id, year: fy },
        attributes: ["id"],
        raw: true,
      }).then((rows) => rows.map((r) => r.id));
      if (range) {
        if (cropIdsForYear.length > 0) {
          // Include expenses that are either: (1) date in FY range, or (2) linked to a crop of this year
          where[Op.or] = [
            { date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate } },
            { crop_id: { [Op.in]: cropIdsForYear } },
          ];
        } else {
          where.date = { [Op.gte]: range.startDate, [Op.lte]: range.endDate };
        }
      }
    } else if (year) {
      where.year = Number(year);
    }

    const { count, rows } = await Expense.findAndCountAll({
      where,
      include: [{ model: Crop, as: "Crop", attributes: ["id", "crop_name"], required: false }],
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });
    const data = rows.map((row) => {
      const mapped = mapExpense(row);
      if (row.Crop && mapped.cropId) {
        mapped.cropId = { _id: row.Crop.id, cropName: row.Crop.crop_name };
      }
      return mapped;
    });
    res.json({
      success: true,
      data,
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

/** GET /expenses/analytics — per-bigha comparison (my vs avg) for exact idea; also total for reference */
router.get(
  "/analytics",
  auth,
  asyncHandler(async (req, res) => {
    const { financialYear } = req.query;
    const fy = financialYear || getFinancialYearFromDate();
    const range = parseFinancialYear(fy);
    if (!range) {
      return res.status(400).json({ success: false, message: "Invalid financialYear." });
    }
    const dateWhere = { date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate } };
    const categories = ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery", "Irrigation", "Other"];

    const myRows = await Expense.findAll({
      attributes: ["category", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: req.user.id, ...dateWhere },
      group: ["category"],
      raw: true,
    });
    const mySummary = myRows.map((r) => ({ _id: r.category, total: parseFloat(r.total) || 0 }));
    const myByCategory = {};
    mySummary.forEach((s) => { myByCategory[s._id] = s.total; });

    const myCrops = await Crop.findAll({
      attributes: [[sequelize.fn("SUM", sequelize.col("area")), "totalArea"]],
      where: { user_id: req.user.id, year: fy },
      raw: true,
    });
    const myArea = parseFloat(myCrops[0]?.totalArea) || 0;
    const myPerBighaByCategory = {};
    if (myArea > 0) {
      categories.forEach((cat) => {
        myPerBighaByCategory[cat] = Math.round(((myByCategory[cat] || 0) / myArea) * 100) / 100;
      });
    }

    const myProfile = await FarmerProfile.findOne({ where: { user_id: req.user.id }, attributes: ["data_sharing"] });
    const myConsent = myProfile?.data_sharing === true;
    let avgByCategory = {};
    let avgPerBighaByCategory = {};
    let sampleSize = 0;
    if (myConsent) {
      const consented = await FarmerProfile.findAll({ where: { data_sharing: true }, attributes: ["user_id"] });
      const consentedIds = consented.map((p) => p.user_id).filter((id) => id !== req.user.id);
      if (consentedIds.length > 0) {
        const [allRows, cropAreas] = await Promise.all([
          Expense.findAll({
            attributes: ["user_id", "category", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
            where: { user_id: { [Op.in]: consentedIds }, ...dateWhere },
            group: ["user_id", "category"],
            raw: true,
          }),
          Crop.findAll({
            attributes: ["user_id", [sequelize.fn("SUM", sequelize.col("area")), "totalArea"]],
            where: { user_id: { [Op.in]: consentedIds }, year: fy },
            group: ["user_id"],
            raw: true,
          }),
        ]);
        const byUser = {};
        allRows.forEach((r) => {
          const uid = r.user_id;
          if (!byUser[uid]) byUser[uid] = { expense: {} };
          byUser[uid].expense[r.category] = parseFloat(r.total) || 0;
        });
        cropAreas.forEach((r) => {
          const uid = r.user_id;
          if (!byUser[uid]) byUser[uid] = { expense: {} };
          byUser[uid].area = parseFloat(r.totalArea) || 0;
        });
        const usersWithArea = Object.entries(byUser).filter(([, v]) => v.area > 0);
        sampleSize = usersWithArea.length;
        categories.forEach((cat) => {
          const totals = Object.values(byUser).map((u) => u.expense[cat] || 0);
          avgByCategory[cat] = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
          const perBighaValues = usersWithArea.map(([uid, u]) => (u.expense[cat] || 0) / u.area);
          avgPerBighaByCategory[cat] = perBighaValues.length
            ? Math.round((perBighaValues.reduce((a, b) => a + b, 0) / perBighaValues.length) * 100) / 100
            : 0;
        });
      }
    }
    res.json({
      success: true,
      financialYear: fy,
      mySummary,
      myByCategory,
      myArea,
      myPerBighaByCategory,
      avgByCategory,
      avgPerBighaByCategory,
      sampleSize,
    });
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

router.put(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const expense = await Expense.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!expense) return res.status(404).json({ success: false, message: "Expense not found." });
    const updates = bodyToExpense(req.body, req.user.id);
    await expense.update(updates);
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
