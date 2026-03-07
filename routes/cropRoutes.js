const express = require("express");
const router = express.Router();
const { Crop, Expense, Income, mapCrop, sequelize } = require("../models");
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
      area, areaUnit, sowingDate, harvestDate, status, notes,
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

    const crops = await Crop.findAll({
      where: { user_id: userId, year },
      order: [["created_at", "DESC"]],
    });

    if (!crops.length) {
      return res.json({
        success: true,
        year,
        financialYear: year,
        crops: [],
        summary: { totalIncome: 0, totalExpense: 0, netProfit: 0, totalCrops: 0, totalArea: 0 },
      });
    }

    const cropIds = crops.map((c) => c.id);

    const expenseRows = await Expense.findAll({
      attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "totalExpense"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    });
    const incomeRows = await Income.findAll({
      attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "totalIncome"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    });

    const expenseMap = {};
    expenseRows.forEach((r) => { expenseMap[r.crop_id] = parseFloat(r.totalExpense) || 0; });
    const incomeMap = {};
    incomeRows.forEach((r) => { incomeMap[r.crop_id] = parseFloat(r.totalIncome) || 0; });

    let totalIncome = 0, totalExpense = 0, totalArea = 0;
    const cropReports = crops.map((crop) => {
      const id = crop.id;
      const income = incomeMap[id] ?? 0;
      const expense = expenseMap[id] ?? 0;
      const profit = income - expense;
      totalIncome += income;
      totalExpense += expense;
      totalArea += parseFloat(crop.area) ?? 0;
      const row = mapCrop(crop);
      return { ...row, income, expense, profit };
    });

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
        avgIncome: 0,
        avgExpense: 0,
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

    const { User } = require("../models");
    const currentUser = await User.findByPk(req.user.id);
    let avgIncome = 0, avgExpense = 0, percentileIncome = null, percentileExpense = null, sampleSize = 0;
    if (currentUser?.analytics_consent) {
      const consentedUsers = await User.findAll({ where: { analytics_consent: true }, attributes: ["id"] });
      const consentedIds = consentedUsers.map((u) => u.id).filter((id) => id !== req.user.id);
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
        const userTotals = Object.entries(byUser).map(([uid, { cropIds: cids }]) => {
          const expense = cids.reduce((s, cid) => s + (expByCrop[cid] || 0), 0);
          const income = cids.reduce((s, cid) => s + (incByCrop[cid] || 0), 0);
          return { userId: uid, income, expense };
        });
        sampleSize = userTotals.length;
        if (sampleSize) {
          avgIncome = userTotals.reduce((a, u) => a + u.income, 0) / sampleSize;
          avgExpense = userTotals.reduce((a, u) => a + u.expense, 0) / sampleSize;
          const incomeSorted = userTotals.map((u) => u.income).sort((a, b) => a - b);
          const expenseSorted = userTotals.map((u) => u.expense).sort((a, b) => a - b);
          const belowIncome = incomeSorted.filter((v) => v < myTotalIncome).length;
          const belowExpense = expenseSorted.filter((v) => v < myTotalExpense).length;
          percentileIncome = +(belowIncome / sampleSize * 100).toFixed(1);
          percentileExpense = +(belowExpense / sampleSize * 100).toFixed(1);
        }
      }
    }

    res.json({
      success: true,
      financialYear: fy,
      cropName: cropName || null,
      myTotalIncome,
      myTotalExpense,
      myNetProfit,
      myTotalArea,
      avgIncome: +avgIncome.toFixed(2),
      avgExpense: +avgExpense.toFixed(2),
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
      "area", "areaUnit", "sowingDate", "harvestDate", "status", "notes",
    ];
    const updates = {};
    const map = {
      cropName: "crop_name", cropEmoji: "crop_emoji", subType: "sub_type",
      batchLabel: "batch_label", farmName: "farm_name", areaUnit: "area_unit",
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
