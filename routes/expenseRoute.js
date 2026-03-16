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
    expense_source: body.expenseSource ?? null,
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
    const { cropId, category, year, financialYear, page = 1, limit = 20, expenseSource } = req.query;
    const where = { user_id: req.user.id };
    if (cropId) where.crop_id = cropId;
    if (category) where.category = category;
    if (expenseSource) where.expense_source = expenseSource;
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

/**
 * Compute expense by category with rules:
 * - Exclude Bhagya Upad (ભાગ્યા નો ઉપાડ): crop_id null + Labour — already in crop expense
 * - Bhagma crop Labour/Machinery: split 50-50 between Labour and Machinery (shared cost display)
 */
function computeByCategory(expenseRows, cropMap, categories) {
  const byCategory = {};
  categories.forEach((cat) => { byCategory[cat] = 0; });

  for (const row of expenseRows) {
    const amt = parseFloat(row.amount) || 0;
    if (amt <= 0) continue;

    const cropId = row.crop_id;
    const category = row.category;

    // Exclude Bhagya Upad: general Labour expense (no crop) — not crop expense
    if (!cropId && category === "Labour") continue;

    const crop = cropMap[cropId] || null;
    const isBhagma = crop && crop.land_type === "bhagma" && crop.bhagma_percentage != null;

    if (isBhagma && (category === "Labour" || category === "Machinery")) {
      const half = amt / 2;
      byCategory.Labour += half;
      byCategory.Machinery += half;
    } else if (categories.includes(category)) {
      byCategory[category] += amt;
    }
  }
  return byCategory;
}

/** GET /expenses/analytics — per-bigha comparison (my vs avg) for exact idea; also total for reference */
router.get(
  "/analytics",
  auth,
  asyncHandler(async (req, res) => {
    const { financialYear, peerUserId } = req.query;
    const fy = financialYear || getFinancialYearFromDate();
    const range = parseFinancialYear(fy);
    if (!range) {
      return res.status(400).json({ success: false, message: "Invalid financialYear." });
    }
    const dateWhere = { date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate } };
    const categories = ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery", "Irrigation", "Other"];

    // Fetch expenses with crop_id; include Crop for bhagma check
    const myExpenses = await Expense.findAll({
      attributes: ["crop_id", "category", "amount"],
      where: { user_id: req.user.id, ...dateWhere },
      raw: true,
    });
    const myCropIds = [...new Set(myExpenses.map((e) => e.crop_id).filter(Boolean))];
    const myCropRows = myCropIds.length > 0
      ? await Crop.findAll({
          where: { id: { [Op.in]: myCropIds } },
          attributes: ["id", "land_type", "bhagma_percentage"],
          raw: true,
        })
      : [];
    const myCropMap = Object.fromEntries(myCropRows.map((c) => [c.id, c]));
    const myByCategory = computeByCategory(myExpenses, myCropMap, categories);
    const mySummary = categories
      .filter((cat) => (myByCategory[cat] || 0) > 0)
      .map((cat) => ({ _id: cat, total: Math.round(myByCategory[cat] * 100) / 100 }));

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
    let mode = "average";
    let peerUserIdOut = null;
    let peerName = null;
    let peerVillage = null;
    let peerTaluka = null;
    let peerDistrict = null;

    if (myConsent) {
      const consented = await FarmerProfile.findAll({
        where: { data_sharing: true },
        attributes: ["user_id", "name", "village", "taluka", "district"],
      });
      let consentedIds = consented.map((p) => p.user_id).filter((id) => id !== req.user.id);
      if (peerUserId) {
        // If a specific peer is selected, restrict comparison set to that user only (if allowed).
        const peerInList = consentedIds.find((id) => String(id) === String(peerUserId));
        if (peerInList) {
          consentedIds = [peerInList];
          mode = "peer";
          peerUserIdOut = peerInList;
          const p = consented.find((pf) => String(pf.user_id) === String(peerInList));
          if (p) {
            peerName = p.name;
            peerVillage = p.village;
            peerTaluka = p.taluka;
            peerDistrict = p.district;
          }
        }
      }

      if (consentedIds.length > 0) {
        const [allExpenses, cropAreas] = await Promise.all([
          Expense.findAll({
            attributes: ["user_id", "crop_id", "category", "amount"],
            where: { user_id: { [Op.in]: consentedIds }, ...dateWhere },
            raw: true,
          }),
          Crop.findAll({
            attributes: ["user_id", [sequelize.fn("SUM", sequelize.col("area")), "totalArea"]],
            where: { user_id: { [Op.in]: consentedIds }, year: fy },
            group: ["user_id"],
            raw: true,
          }),
        ]);
        const cropIdsFromExpenses = [...new Set(allExpenses.map((e) => e.crop_id).filter(Boolean))];
        const allCrops = cropIdsFromExpenses.length > 0
          ? await Crop.findAll({
              where: { id: { [Op.in]: cropIdsFromExpenses } },
              attributes: ["id", "land_type", "bhagma_percentage"],
              raw: true,
            })
          : [];
        const cropMap = Object.fromEntries(allCrops.map((c) => [c.id, c]));
        const byUser = {};
        const expensesByUser = {};
        allExpenses.forEach((e) => {
          const uid = e.user_id;
          if (!expensesByUser[uid]) expensesByUser[uid] = [];
          expensesByUser[uid].push(e);
        });
        cropAreas.forEach((r) => {
          const uid = r.user_id;
          if (!byUser[uid]) byUser[uid] = { expense: {}, area: 0 };
          byUser[uid].area = parseFloat(r.totalArea) || 0;
        });
        Object.entries(expensesByUser).forEach(([uid, rows]) => {
          if (!byUser[uid]) byUser[uid] = { expense: {}, area: 0 };
          byUser[uid].expense = computeByCategory(rows, cropMap, categories);
        });
        const usersWithArea = Object.entries(byUser).filter(([, v]) => v.area > 0);
        sampleSize = usersWithArea.length;

        if (mode === "peer" && peerUserIdOut) {
          // Use only the selected peer's expense data for comparison.
          const peerEntry = usersWithArea.find(([uid]) => String(uid) === String(peerUserIdOut));
          const peerData = peerEntry ? peerEntry[1] : null;
          if (peerData) {
            categories.forEach((cat) => {
              const total = peerData.expense[cat] || 0;
              avgByCategory[cat] = total;
              const perBigha = peerData.area > 0 ? total / peerData.area : 0;
              avgPerBighaByCategory[cat] = Math.round(perBigha * 100) / 100;
            });
            sampleSize = 1;
          }
        } else {
          categories.forEach((cat) => {
            const totals = usersWithArea.map(([, u]) => u.expense[cat] || 0);
            avgByCategory[cat] = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : 0;
            const perBighaValues = usersWithArea.map(([, u]) => (u.expense[cat] || 0) / u.area);
            avgPerBighaByCategory[cat] = perBighaValues.length
              ? Math.round((perBighaValues.reduce((a, b) => a + b, 0) / perBighaValues.length) * 100) / 100
              : 0;
          });
        }
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
      mode,
      peerUserId: peerUserIdOut,
      peerName,
      peerVillage,
      peerTaluka,
      peerDistrict,
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
