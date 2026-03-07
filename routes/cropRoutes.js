const express = require("express");
const router = express.Router();
const { Crop, Expense, Income, mapCrop, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const {
      season, cropName, cropEmoji, subType, batchLabel, year,
      area, areaUnit, sowingDate, harvestDate, status, notes, expectedYieldKg,
    } = req.body;

    if (!season || !cropName || !area) {
      return res.status(400).json({
        success: false,
        message: "season, cropName, and area are required.",
      });
    }

    const currentYear = year ?? new Date().getFullYear();
    const crop = await Crop.create({
      user_id: req.user.id,
      season,
      crop_name: cropName,
      crop_emoji: cropEmoji ?? "🌱",
      sub_type: subType ?? "",
      batch_label: batchLabel ?? "",
      year: currentYear,
      area: Number(area),
      area_unit: areaUnit ?? "Bigha",
      sowing_date: sowingDate ?? null,
      harvest_date: harvestDate ?? null,
      status: status ?? "Active",
      notes: notes ?? "",
      expected_yield_kg: expectedYieldKg ?? null,
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
    const years = rows.map((r) => r.year).filter(Boolean).sort((a, b) => b - a);
    res.json({ success: true, years });
  })
);

router.get(
  "/report/yearly",
  auth,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const year = Number(req.query.year) || new Date().getFullYear();

    const crops = await Crop.findAll({
      where: { user_id: userId, year },
      order: [["created_at", "DESC"]],
    });

    if (!crops.length) {
      return res.json({
        success: true,
        year,
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
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { season, status, year, page = 1, limit = 20 } = req.query;
    const filter = { user_id: req.user.id };
    if (season) filter.season = season;
    if (status) filter.status = status;
    if (year) filter.year = Number(year);

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
      "season", "cropName", "cropEmoji", "subType", "batchLabel", "year",
      "area", "areaUnit", "sowingDate", "harvestDate", "status", "notes",
      "expectedYieldKg", "actualYieldKg",
    ];
    const updates = {};
    const map = {
      cropName: "crop_name", cropEmoji: "crop_emoji", subType: "sub_type",
      batchLabel: "batch_label", areaUnit: "area_unit", sowingDate: "sowing_date",
      harvestDate: "harvest_date", expectedYieldKg: "expected_yield_kg", actualYieldKg: "actual_yield_kg",
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
    await crop.update({ status });
    res.json({ success: true, data: mapCrop(crop) });
  })
);

router.patch(
  "/:id/harvest",
  auth,
  asyncHandler(async (req, res) => {
    const harvestDate = req.body.harvestDate ? new Date(req.body.harvestDate) : new Date();
    const actualYieldKg = req.body.actualYieldKg ?? null;
    const crop = await Crop.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!crop) return res.status(404).json({ success: false, message: "Crop not found." });
    await crop.update({
      status: "Harvested",
      harvest_date: harvestDate,
      ...(actualYieldKg !== null && { actual_yield_kg: actualYieldKg }),
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
