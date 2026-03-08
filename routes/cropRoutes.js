const express = require("express");
const router = express.Router();
const { Crop, Expense, Income, FarmerProfile, mapCrop, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { getFinancialYearFromDate, parseFinancialYear, sortFinancialYearsDesc } = require("../utils/financialYear");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const {
      season, cropName, cropEmoji, subType, batchLabel, farmName, year,
      area, areaUnit, landType, bhagmaPercentage, bhagmaExpensePctOfIncome, sowingDate, harvestDate, status, notes,
    } = req.body;

    if (!season || !cropName || !area) {
      return res.status(400).json({
        success: false,
        message: "season, cropName, and area are required.",
      });
    }

    const defaultSowingDate = new Date().toISOString().slice(0, 10);
    const financialYear = year && typeof year === "string" ? year : (year ? `${year}-${String((Number(year) + 1) % 100).padStart(2, "0")}` : getFinancialYearFromDate());
    const crop = await Crop.create({
      user_id: req.user.id,
      season,
      crop_name: cropName,
      crop_emoji: cropEmoji ?? "🌱",
      sub_type: subType ?? "",
      batch_label: batchLabel ?? "",
      farm_name: farmName ?? null,
      year: financialYear,
      area: Number(area),
      area_unit: areaUnit ?? "Bigha",
      land_type: landType ?? null,
      bhagma_percentage: bhagmaPercentage != null ? Number(bhagmaPercentage) : null,
      bhagma_expense_pct_of_income: bhagmaExpensePctOfIncome != null && bhagmaExpensePctOfIncome !== "" ? Number(bhagmaExpensePctOfIncome) : null,
      sowing_date: sowingDate ?? defaultSowingDate,
      harvest_date: harvestDate ?? null,
      status: status ?? "Active",
      notes: notes ?? "",
    });

    res.status(201).json({ success: true, data: mapCrop(crop) });
  })
);

router.get(
  "/report/years",
  auth,
  asyncHandler(async (req, res) => {
    const rows = await Crop.findAll({
      attributes: [[sequelize.fn("DISTINCT", sequelize.col("year")), "year"]],
      where: { user_id: req.user.id },
      raw: true,
    });
    const years = sortFinancialYearsDesc(rows.map((r) => r.year).filter(Boolean));
    res.json({ success: true, years });
  })
);

router.get(
  "/report/yearly",
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const financialYear = req.query.financialYear || req.query.year;
    const year = typeof financialYear === "string" && financialYear.includes("-")
      ? financialYear
      : (Number(financialYear) ? `${financialYear}-${String((Number(financialYear) + 1) % 100).padStart(2, "0")}` : getFinancialYearFromDate());

    const range = parseFinancialYear(year);
    const dateWhere = range ? { date: { [Op.gte]: range.startDate, [Op.lte]: range.endDate } } : {};

    const crops = await Crop.findAll({
      where: { user_id: userId, year },
      order: [["created_at", "DESC"]],
    });

    const cropIds = crops.length ? crops.map((c) => c.id) : [];

    // Crop-linked income/expense: include all transactions for this year's crops (by crop year, not transaction date)
    // so that when user selects 2026-27, expenses added for 2026-27 crops show and totals are correct
    const cropLinkedWhere = { user_id: userId, crop_id: { [Op.in]: cropIds } };
    const baseWhere = { user_id: userId, ...dateWhere };
    let cropIncomeTotal = 0;
    let cropExpenseTotal = 0;
    const expenseMap = {};
    const incomeMap = {};

    // Per-crop expense by category (for bhagma: farmer's direct = Seed + Fertilizer + Pesticide only)
    const FARMER_DIRECT_CATEGORIES = ["Seed", "Fertilizer", "Pesticide"]; // biyaran, khatar, jantunasak
    let expenseByCropCategory = {}; // cropId -> { Seed: sum, Fertilizer: sum, ... }
    // Per-crop income by category: 25% labour share only on વેચણ (Crop Sale), not on Subsidy
    let incomeByCropCategory = {}; // cropId -> { "Crop Sale": sum, "Subsidy": sum, ... }

    if (cropIds.length > 0) {
      const expenseRows = await Expense.findAll({
        attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "totalExpense"]],
        where: cropLinkedWhere,
        group: ["crop_id"],
        raw: true,
      });
      const expenseByCategoryRows = await Expense.findAll({
        attributes: ["crop_id", "category", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: cropLinkedWhere,
        group: ["crop_id", "category"],
        raw: true,
      });
      expenseByCategoryRows.forEach((r) => {
        const cid = r.crop_id;
        if (!expenseByCropCategory[cid]) expenseByCropCategory[cid] = {};
        expenseByCropCategory[cid][r.category] = parseFloat(r.total) || 0;
      });
      expenseRows.forEach((r) => {
        const val = parseFloat(r.totalExpense) || 0;
        expenseMap[r.crop_id] = val;
        cropExpenseTotal += val;
      });
      const incomeRows = await Income.findAll({
        attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "totalIncome"]],
        where: cropLinkedWhere,
        group: ["crop_id"],
        raw: true,
      });
      const incomeByCategoryRows = await Income.findAll({
        attributes: ["crop_id", "category", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: cropLinkedWhere,
        group: ["crop_id", "category"],
        raw: true,
      });
      incomeByCategoryRows.forEach((r) => {
        const cid = r.crop_id;
        if (!incomeByCropCategory[cid]) incomeByCropCategory[cid] = {};
        incomeByCropCategory[cid][r.category] = parseFloat(r.total) || 0;
      });
      incomeRows.forEach((r) => {
        const val = parseFloat(r.totalIncome) || 0;
        incomeMap[r.crop_id] = val;
        cropIncomeTotal += val;
      });
    }

    // Extra income (no crop) and extra expense (no crop) for this FY
    // Exclude Bhagya Upad (ભાગ્યા નો ઉપાડ): crop_id null + Labour — already in crop labour share
    const [extraIncomeRow, extraExpenseRow] = await Promise.all([
      Income.findOne({
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: { ...baseWhere, crop_id: null },
        raw: true,
      }),
      Expense.findOne({
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: { ...baseWhere, crop_id: null, category: { [Op.ne]: "Labour" } },
        raw: true,
      }),
    ]);
    const extraIncomeTotal = parseFloat(extraIncomeRow?.total) || 0;
    const extraExpenseTotal = parseFloat(extraExpenseRow?.total) || 0;

    const totalArea = crops.reduce((sum, c) => sum + (parseFloat(c.area) || 0), 0);

    // Per-crop: for bhagma, expense = 25% of profit + biyaran + khatar + jantunasak (Seed+Fertilizer+Pesticide)
    const cropReports = crops.map((crop) => {
      const id = crop.id;
      const income = incomeMap[id] ?? 0;
      const isBhagma = crop.land_type === "bhagma" && crop.bhagma_percentage != null;
      const pct = isBhagma ? Number(crop.bhagma_percentage) : 0;
      const byCat = expenseByCropCategory[id] || {};
      let expense;
      let profit;
      let labourShare = null;
      let farmerDirectExpense = null;

      if (isBhagma && pct > 0) {
        // Farmer's direct expense = બિયારણ + ખતર + જંતુનાશક (Seed, Fertilizer, Pesticide)
        farmerDirectExpense = FARMER_DIRECT_CATEGORIES.reduce((s, cat) => s + (byCat[cat] || 0), 0);
        // Labour share only on વેચણ (Crop Sale), not on સબસિડી (Subsidy) or other income
        const incomeByCat = incomeByCropCategory[id] || {};
        const cropSaleIncome = incomeByCat["Crop Sale"] || 0;
        labourShare = (pct / 100) * cropSaleIncome;
        // Final expense = biyaran + khatar + jantunasak + labour share (25% of vechan only)
        expense = farmerDirectExpense + labourShare;
        profit = income - expense; // farmer's net (total income minus expense)
      } else {
        expense = expenseMap[id] ?? 0;
        profit = income - expense;
      }

      const row = mapCrop(crop);
      const out = { ...row, income, expense, profit };
      if (labourShare != null) out.labourShare = Math.round(labourShare * 100) / 100;
      if (farmerDirectExpense != null) out.farmerDirectExpense = Math.round(farmerDirectExpense * 100) / 100;
      return out;
    });

    // Recompute crop totals from per-crop (bhagma crops use new expense)
    cropExpenseTotal = cropReports.reduce((s, c) => s + c.expense, 0);
    const totalIncome = cropIncomeTotal + extraIncomeTotal;
    const totalExpense = cropExpenseTotal + extraExpenseTotal;

    const seasonBreakdown = {};
    cropReports.forEach((c) => {
      const s = c.season;
      if (!seasonBreakdown[s]) seasonBreakdown[s] = { income: 0, expense: 0, profit: 0, crops: 0, area: 0 };
      seasonBreakdown[s].income += c.income;
      seasonBreakdown[s].expense += c.expense;
      seasonBreakdown[s].profit += c.profit;
      seasonBreakdown[s].crops += 1;
      seasonBreakdown[s].area += c.area;
    });

    res.json({
      success: true,
      year,
      financialYear: year,
      crops: cropReports,
      seasonBreakdown,
      summary: {
        totalIncome,
        totalExpense,
        netProfit: totalIncome - totalExpense,
        totalCrops: crops.length,
        totalArea,
        cropIncome: cropIncomeTotal,
        cropExpense: cropExpenseTotal,
        extraIncome: extraIncomeTotal,
        extraExpense: extraExpenseTotal,
      },
    });
  })
);

router.get(
  "/report/compare",
  auth,
  asyncHandler(async (req, res) => {
    const { financialYear, cropName } = req.query;
    const fy = typeof financialYear === "string" && financialYear
      ? financialYear
      : getFinancialYearFromDate();

    const crops = await Crop.findAll({
      where: {
        user_id: req.user.id,
        year: fy,
        ...(cropName ? { crop_name: cropName } : {}),
      },
      attributes: ["id", "area"],
    });
    const cropIds = crops.map((c) => c.id);
    const myTotalArea = crops.reduce((sum, c) => sum + (parseFloat(c.area) || 0), 0);
    if (!cropIds.length) {
      return res.json({
        success: true,
        financialYear: fy,
        cropName: cropName || null,
        myTotalIncome: 0,
        myTotalExpense: 0,
        myNetProfit: 0,
        myTotalArea: 0,
        myIncomePerBigha: 0,
        avgIncome: 0,
        avgExpense: 0,
        avgIncomePerBigha: 0,
        percentileIncome: null,
        percentileExpense: null,
        sampleSize: 0,
      });
    }

    const [myExp, myInc] = await Promise.all([
      Expense.findAll({
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: { crop_id: { [Op.in]: cropIds } },
        raw: true,
      }),
      Income.findAll({
        attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
        where: { crop_id: { [Op.in]: cropIds } },
        raw: true,
      }),
    ]);
    const myTotalExpense = parseFloat(myExp[0]?.total) || 0;
    const myTotalIncome = parseFloat(myInc[0]?.total) || 0;
    const myNetProfit = myTotalIncome - myTotalExpense;

    const myProfile = await FarmerProfile.findOne({ where: { user_id: req.user.id }, attributes: ["data_sharing"] });
    const myConsent = myProfile?.data_sharing === true;
    let avgIncome = 0, avgExpense = 0, avgIncomePerBigha = 0, percentileIncome = null, percentileExpense = null, sampleSize = 0;
    if (myConsent) {
      const consentedProfiles = await FarmerProfile.findAll({ where: { data_sharing: true }, attributes: ["user_id"] });
      const consentedIds = consentedProfiles.map((p) => p.user_id).filter((id) => id !== req.user.id);
      if (consentedIds.length) {
        const allCrops = await Crop.findAll({
          where: { user_id: { [Op.in]: consentedIds }, year: fy, ...(cropName ? { crop_name: cropName } : {}) },
          attributes: ["id", "user_id", "area"],
        });
        const byUser = {};
        allCrops.forEach((c) => {
          if (!byUser[c.user_id]) byUser[c.user_id] = { cropIds: [], area: 0 };
          byUser[c.user_id].cropIds.push(c.id);
          byUser[c.user_id].area += parseFloat(c.area) || 0;
        });
        const allCropIds = allCrops.map((c) => c.id);
        const [expRows, incRows] = await Promise.all([
          Expense.findAll({
            attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
            where: { crop_id: { [Op.in]: allCropIds } },
            group: ["crop_id"],
            raw: true,
          }),
          Income.findAll({
            attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
            where: { crop_id: { [Op.in]: allCropIds } },
            group: ["crop_id"],
            raw: true,
          }),
        ]);
        const expByCrop = {}; expRows.forEach((r) => { expByCrop[r.crop_id] = parseFloat(r.total) || 0; });
        const incByCrop = {}; incRows.forEach((r) => { incByCrop[r.crop_id] = parseFloat(r.total) || 0; });
        const userTotals = Object.entries(byUser).map(([uid, { cropIds: cids, area }]) => {
          const expense = cids.reduce((s, cid) => s + (expByCrop[cid] || 0), 0);
          const income = cids.reduce((s, cid) => s + (incByCrop[cid] || 0), 0);
          const areaNum = parseFloat(area) || 0;
          const incomePerBigha = areaNum > 0 ? income / areaNum : 0;
          return { userId: uid, income, expense, area: areaNum, incomePerBigha };
        });
        sampleSize = userTotals.length;
        if (sampleSize) {
          avgIncome = userTotals.reduce((a, u) => a + u.income, 0) / sampleSize;
          avgExpense = userTotals.reduce((a, u) => a + u.expense, 0) / sampleSize;
          const withArea = userTotals.filter((u) => u.area > 0);
          const avgIncomePerBighaNum = withArea.length ? withArea.reduce((a, u) => a + u.incomePerBigha, 0) / withArea.length : 0;
          avgIncomePerBigha = +avgIncomePerBighaNum.toFixed(2);
          const incomeSorted = userTotals.map((u) => u.income).sort((a, b) => a - b);
          const expenseSorted = userTotals.map((u) => u.expense).sort((a, b) => a - b);
          const belowIncome = incomeSorted.filter((v) => v < myTotalIncome).length;
          const belowExpense = expenseSorted.filter((v) => v < myTotalExpense).length;
          percentileIncome = +(belowIncome / sampleSize * 100).toFixed(1);
          percentileExpense = +(belowExpense / sampleSize * 100).toFixed(1);
        }
      }
    }

    const myIncomePerBigha = myTotalArea > 0 ? +(myTotalIncome / myTotalArea).toFixed(2) : 0;

    res.json({
      success: true,
      financialYear: fy,
      cropName: cropName || null,
      myTotalIncome,
      myTotalExpense,
      myNetProfit,
      myTotalArea,
      myIncomePerBigha,
      avgIncome: +avgIncome.toFixed(2),
      avgExpense: +avgExpense.toFixed(2),
      avgIncomePerBigha: avgIncomePerBigha ?? 0,
      percentileIncome,
      percentileExpense,
      sampleSize,
    });
  })
);

router.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { season, status, year, financialYear, page = 1, limit = 20 } = req.query;
    const filter = { user_id: req.user.id };
    if (season) filter.season = season;
    if (status) filter.status = status;
    const yr = financialYear || year;
    if (yr) filter.year = typeof yr === "string" ? yr : `${yr}-${String((Number(yr) + 1) % 100).padStart(2, "0")}`;

    const { count, rows } = await Crop.findAndCountAll({
      where: filter,
      order: [["created_at", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });

    res.json({
      success: true,
      data: rows.map(mapCrop),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  })
);

router.get(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    res.json({ success: true, data: mapCrop(crop) });
  })
);

router.put(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const allowed = [
      "season", "cropName", "cropEmoji", "subType", "batchLabel", "farmName", "year",
      "area", "areaUnit", "landType", "bhagmaPercentage", "bhagmaExpensePctOfIncome", "sowingDate", "harvestDate", "status", "notes",
    ];
    const updates = {};
    const map = {
      cropName: "crop_name", cropEmoji: "crop_emoji", subType: "sub_type",
      batchLabel: "batch_label", farmName: "farm_name", areaUnit: "area_unit",
      landType: "land_type", bhagmaPercentage: "bhagma_percentage",
      bhagmaExpensePctOfIncome: "bhagma_expense_pct_of_income",
      sowingDate: "sowing_date", harvestDate: "harvest_date",
    };
    allowed.forEach((key) => {
      if (req.body[key] === undefined) return;
      updates[map[key] || key] = req.body[key];
    });
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: "No valid fields to update." });
    }

    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    await crop.update(updates);
    res.json({ success: true, data: mapCrop(crop) });
  })
);

router.patch(
  "/:id/status",
  auth,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    const valid = ["Active", "Harvested", "Closed"];
    if (!valid.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${valid.join(", ")}` });
    }
    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    const updates = { status };
    if (status === "Harvested" && !crop.harvest_date) {
      updates.harvest_date = new Date().toISOString().slice(0, 10);
    }
    await crop.update(updates);
    const updated = await Crop.findByPk(crop.id);
    res.json({ success: true, data: mapCrop(updated) });
  })
);

router.patch(
  "/:id/harvest",
  auth,
  asyncHandler(async (req, res) => {
    const harvestDateStr = req.body.harvestDate
      ? (new Date(req.body.harvestDate).toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10);
    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    await crop.update({
      status: "Harvested",
      harvest_date: harvestDateStr,
    });
    const updated = await Crop.findByPk(crop.id);
    res.json({ success: true, data: mapCrop(updated) });
  })
);

router.delete(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    const cropId = crop.id;
    await Promise.all([
      Expense.destroy({ where: { crop_id: cropId } }),
      Income.destroy({ where: { crop_id: cropId } }),
    ]);
    await crop.destroy();
    res.json({ success: true, message: "Crop and all linked expenses/income deleted successfully." });
  })
);

module.exports = router;
