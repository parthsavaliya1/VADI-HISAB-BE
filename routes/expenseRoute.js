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
    const { cropId, category, date } = req.body;
    if (!category) {
      return res.status(400).json({ success: false, message: "category is required." });
    }
    // cropId optional: null/omit for general expense (સામાન્ય ખર્ચ)
    const VALID_CATEGORIES = ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery", "Irrigation", "Other"];
    if (!VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({ success: false, message: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    const parsedDate = date ? new Date(date) : new Date();
    const financialYearOverride =
      typeof req.body.financialYear === "string" ? req.body.financialYear.trim() : null;
    let financialYearToSet = null;

    // Keep fiscal year aligned with crop.year (like crops table),
    // so crop-linked expenses show up in the correct FY even if `date` is "today".
    if (cropId) {
      const crop = await Crop.findOne({
        where: { user_id: req.user.id, id: cropId },
        attributes: ["year"],
        raw: true,
      });
      if (!crop?.year) {
        return res.status(400).json({
          success: false,
          message: "Invalid cropId (no crop year found).",
        });
      }
      financialYearToSet = crop.year;
    } else {
      // For non-crop expenses (including bhagyaUpad + tractorExpense),
      // allow FY override from the selected year tab.
      if (financialYearOverride && parseFinancialYear(financialYearOverride)) {
        financialYearToSet = financialYearOverride;
      } else {
        financialYearToSet = getFinancialYearFromDate(parsedDate);
      }
    }

    const payload = bodyToExpense(req.body, req.user.id);
    payload.year = financialYearToSet;
    const expense = await Expense.create(payload);
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
    const yearStr = year != null && year !== "" ? String(year).trim() : "";
    const fy = financialYear || (yearStr.includes("-") ? yearStr : null);
    if (fy) {
      // FY is stored directly on expenses.year (financialYear like "2025-26").
      where.year = fy;
    } else if (yearStr) {
      // Backward compatibility for numeric `year` (calendar year). Reject "" → Number("") === 0.
      const yNum = Number(yearStr);
      if (Number.isFinite(yNum) && yNum >= 1 && yNum <= 9999) {
        where.date = { [Op.between]: [`${yNum}-01-01`, `${yNum}-12-31`] };
      }
    }

    // distinct + col: avoid Postgres "ambiguous id" / broken COUNT subquery when joining crops.
    const { count, rows } = await Expense.findAndCountAll({
      where,
      include: [{ model: Crop, as: "Crop", attributes: ["id", "crop_name"], required: false }],
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
      distinct: true,
      col: "id",
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
    const yearStr = year != null && year !== "" ? String(year).trim() : "";
    const fy = financialYear || (yearStr.includes("-") ? yearStr : null);
    if (fy) {
      where.year = fy;
    } else if (yearStr) {
      const yNum = Number(yearStr);
      if (Number.isFinite(yNum) && yNum >= 1 && yNum <= 9999) {
        where.date = { [Op.between]: [`${yNum}-01-01`, `${yNum}-12-31`] };
      }
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
    const { financialYear, peerUserId, cropName } = req.query;
    const fy = financialYear || getFinancialYearFromDate();
    const range = parseFinancialYear(fy);
    if (!range) {
      return res.status(400).json({ success: false, message: "Invalid financialYear." });
    }
    // FY is stored directly on expenses.year (financialYear like "2025-26").
    // Using `year` avoids mis-bucketing when `date` falls in a different FY range.
    const dateWhere = { year: fy };
    const categories = ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery", "Irrigation", "Other"];

    // ── My side: optionally restrict to a single cropName for this FY ────────────
    let myCropRows = [];
    if (cropName) {
      myCropRows = await Crop.findAll({
        where: { user_id: req.user.id, year: fy, crop_name: cropName },
        attributes: ["id", "land_type", "bhagma_percentage", "area"],
        raw: true,
      });
    } else {
      const allMyCropIdsForYear = await Crop.findAll({
        where: { user_id: req.user.id, year: fy },
        attributes: ["id", "land_type", "bhagma_percentage", "area"],
        raw: true,
      });
      myCropRows = allMyCropIdsForYear;
    }
    const myCropIds = myCropRows.map((c) => c.id);

    // After fetching myCropIds...
    const myExpenses = await Expense.findAll({
      attributes: ["crop_id", "category", "amount"],
      where: { user_id: req.user.id, ...dateWhere },
      raw: true,
    });

    // const myExpenses = await Expense.findAll({
    //   attributes: ["crop_id", "category", "amount"],
    //   where: {
    //     user_id: req.user.id,
    //     ...dateWhere,
    //     ...(myCropIds.length > 0 ? { crop_id: { [Op.in]: myCropIds } } : {}),
    //   },
    //   raw: true,
    // });
    const myCropMap = Object.fromEntries(myCropRows.map((c) => [c.id, c]));
    const myByCategory = computeByCategory(myExpenses, myCropMap, categories);
    const mySummary = categories
      .filter((cat) => (myByCategory[cat] || 0) > 0)
      .map((cat) => ({ _id: cat, total: Math.round(myByCategory[cat] * 100) / 100 }));

    // When cropName is set: only area of that crop; otherwise full area for FY
    let myArea = 0;
    if (myCropRows.length > 0) {
      myArea = myCropRows.reduce((sum, c) => sum + (parseFloat(c.area) || 0), 0);
    }
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
        // Fetch all crops for consented users for this FY, optionally limited to cropName
        const peerCrops = await Crop.findAll({
          attributes: ["id", "user_id", "land_type", "bhagma_percentage", "area", "crop_name"],
          where: {
            user_id: { [Op.in]: consentedIds },
            year: fy,
            ...(cropName ? { crop_name: cropName } : {}),
          },
          raw: true,
        });

        const cropMap = Object.fromEntries(peerCrops.map((c) => [c.id, c]));
        const byUser = {};
        // Sum area per user based only on selected crops (or all crops when no cropName)
        peerCrops.forEach((c) => {
          const uid = c.user_id;
          if (!byUser[uid]) byUser[uid] = { expense: {}, area: 0 };
          byUser[uid].area += parseFloat(c.area) || 0;
        });

        // Fetch expenses for those users; if cropName is set, only for those crop_ids
        const allExpensesRaw = await Expense.findAll({
          attributes: ["user_id", "crop_id", "category", "amount"],
          where: { user_id: { [Op.in]: consentedIds }, ...dateWhere },
          raw: true,
        });
        const allowedCropIds = new Set(Object.keys(cropMap));
        const allExpenses = cropName
          ? allExpensesRaw.filter((e) => e.crop_id && allowedCropIds.has(String(e.crop_id)))
          : allExpensesRaw;
        const expensesByUser = {};
        allExpenses.forEach((e) => {
          const uid = e.user_id;
          if (!expensesByUser[uid]) expensesByUser[uid] = [];
          expensesByUser[uid].push(e);
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
    const financialYearOverride =
      typeof req.body.financialYear === "string" ? req.body.financialYear.trim() : null;

    // Keep year aligned with crop.year (or FY from date for general expenses).
    if (updates.crop_id) {
      const crop = await Crop.findOne({
        where: { user_id: req.user.id, id: updates.crop_id },
        attributes: ["year"],
        raw: true,
      });
      if (crop?.year) updates.year = crop.year;
    } else {
      if (financialYearOverride && parseFinancialYear(financialYearOverride)) {
        updates.year = financialYearOverride;
      } else {
        updates.year = getFinancialYearFromDate(new Date(updates.date || new Date()));
      }
    }
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
