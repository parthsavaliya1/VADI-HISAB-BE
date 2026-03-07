const express = require("express");
const router = express.Router();
const { Income, User, FarmerProfile, Crop, mapIncome, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");

function bodyToIncome(body, userId) {
  const row = {
    user_id: userId,
    crop_id: body.cropId ?? null,
    category: body.category,
    date: body.date ?? new Date(),
    notes: body.notes ?? "",
    crop_sale: body.cropSale ?? null,
    subsidy: body.subsidy ?? null,
    rental_income: body.rentalIncome ?? null,
    other_income: body.otherIncome ?? null,
  };
  return row;
}

router.post("/", auth, async (req, res) => {
  try {
    const income = await Income.create(bodyToIncome(req.body, req.user.id));
    res.status(201).json({ success: true, data: mapIncome(income) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    const { year, category, cropId, page = 1, limit = 20 } = req.query;
    const where = { user_id: req.user.id };
    if (year) where.year = Number(year);
    if (category) where.category = category;
    if (cropId) where.crop_id = cropId;

    const { count, rows } = await Income.findAndCountAll({
      where,
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });
    res.json({
      success: true,
      data: rows.map(mapIncome),
      pagination: { total: count, page: Number(page), limit: Number(limit) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/summary", auth, async (req, res) => {
  try {
    const { year } = req.query;
    const where = { user_id: req.user.id };
    if (year) where.year = Number(year);

    const rows = await Income.findAll({
      attributes: ["category", [sequelize.fn("SUM", sequelize.col("amount")), "totalAmount"], [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where,
      group: ["category"],
      raw: true,
    });
    const summary = rows.map((r) => ({ _id: r.category, totalAmount: parseFloat(r.totalAmount) || 0, count: parseInt(r.count, 10) }));
    summary.sort((a, b) => b.totalAmount - a.totalAmount);
    const grandTotal = summary.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    res.json({ success: true, year: year || "all", summary, grandTotal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/analytics", auth, async (req, res) => {
  try {
    const currentUser = await User.findByPk(req.user.id);
    if (!currentUser || !currentUser.analytics_consent) {
      return res.status(403).json({
        success: false,
        message: "Analytics not available. Please enable analytics consent in settings.",
      });
    }
    const { year, district } = req.query;
    const currentYear = Number(year) || new Date().getFullYear();

    const mySum = await Income.findOne({
      attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: req.user.id, year: currentYear },
      raw: true,
    });
    const myTotal = parseFloat(mySum?.total) || 0;

    const consentedUsers = await User.findAll({ where: { analytics_consent: true }, attributes: ["id"] });
    let consentedIds = consentedUsers.map((u) => u.id);
    if (district) {
      const profiles = await FarmerProfile.findAll({ where: { district }, attributes: ["user_id"] });
      const districtIds = profiles.map((p) => p.user_id);
      consentedIds = consentedIds.filter((id) => districtIds.includes(id));
    }

    const allTotals = await Income.findAll({
      attributes: ["user_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: { [Op.in]: consentedIds }, year: currentYear },
      group: ["user_id"],
      raw: true,
    });
    const totalsArr = allTotals.map((u) => parseFloat(u.total) || 0).sort((a, b) => a - b);
    const avgTotal = totalsArr.length ? +(totalsArr.reduce((a, b) => a + b, 0) / totalsArr.length).toFixed(2) : 0;
    const below = totalsArr.filter((t) => t < myTotal).length;
    const percentileRank = totalsArr.length ? +((below / totalsArr.length) * 100).toFixed(1) : null;

    const topCropRows = await Income.findAll({
      attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: req.user.id, year: currentYear, category: "Crop Sale" },
      group: ["crop_id"],
      order: [[sequelize.literal("total"), "DESC"]],
      limit: 1,
      raw: true,
    });
    let topCropByIncome = null;
    if (topCropRows[0] && topCropRows[0].crop_id) {
      const c = await Crop.findByPk(topCropRows[0].crop_id, { attributes: ["crop_name"] });
      topCropByIncome = { _id: c?.crop_name || "Crop", total: parseFloat(topCropRows[0].total) };
    }

    const advice = [];
    if (percentileRank !== null) {
      if (percentileRank < 30) advice.push("Your income is in the bottom 30% of farmers in your area. Consider reviewing your crop selection or selling strategy.");
      else if (percentileRank >= 70) advice.push("Great work! Your income is in the top 30% of farmers in your area.");
      else advice.push("Your income is average compared to other farmers. Small improvements in yield or selling price can move you to the top.");
    }
    if (myTotal < avgTotal * 0.8) advice.push(`Average income for farmers this year is ₹${avgTotal}. You are earning less. Review your expenses to find savings.`);

    res.json({
      success: true,
      year: currentYear,
      myTotal,
      avgTotal,
      percentileRank,
      topCropByIncome,
      advice,
      sampleSize: totalsArr.length,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const income = await Income.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!income) return res.status(404).json({ success: false, message: "Income entry not found." });
    res.json({ success: true, data: mapIncome(income) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", auth, async (req, res) => {
  try {
    const income = await Income.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!income) return res.status(404).json({ success: false, message: "Income entry not found." });
    const { cropId, category, date, notes, cropSale, subsidy, rentalIncome, otherIncome } = req.body;
    if (category !== undefined) income.category = category;
    if (date !== undefined) income.date = date;
    if (notes !== undefined) income.notes = notes;
    if (cropId !== undefined) income.crop_id = cropId;
    if (cropSale !== undefined) income.crop_sale = cropSale;
    if (subsidy !== undefined) income.subsidy = subsidy;
    if (rentalIncome !== undefined) income.rental_income = rentalIncome;
    if (otherIncome !== undefined) income.other_income = otherIncome;
    await income.save();
    res.json({ success: true, data: mapIncome(income) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const income = await Income.findOne({ where: { id: req.params.id, user_id: req.user.id } });
    if (!income) return res.status(404).json({ success: false, message: "Income entry not found." });
    await income.destroy();
    res.json({ success: true, message: "Income deleted successfully." });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
