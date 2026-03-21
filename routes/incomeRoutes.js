const express = require("express");
const router = express.Router();
const { Income, User, FarmerProfile, Crop, mapIncome, sequelize } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { parseFinancialYear, getFinancialYearFromDate } = require("../utils/financialYear");
const {
  createPendingTractorChargeNotification,
  findUserByPhone,
  sendPendingTractorReminderPush,
} = require("../utils/notificationHelpers");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

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

async function notifyPendingRentalIncome(income, providerUserId) {
  const rentalIncome = income?.rental_income;
  if (income?.category !== "Rental Income" || !rentalIncome) return;
  if (rentalIncome.paymentStatus !== "Pending") return;

  const recipient = await findUserByPhone(rentalIncome.farmerPhone);
  if (!recipient) return;

  await createPendingTractorChargeNotification({
    recipientUserId: recipient.id,
    providerUserId,
    sourceType: "Income",
    sourceId: income.id,
    assetType: rentalIncome.assetType,
    amount: income.amount ?? rentalIncome.hoursOrDays * rentalIncome.ratePerUnit,
    serviceDate: income.date,
  });
}

router.post("/", auth, async (req, res) => {
  try {
    const parsedDate = req.body.date ? new Date(req.body.date) : new Date();

    let financialYearToSet = null;
    const cropId = req.body.cropId ?? null;

    // Align income FY with crop.year (like crops table).
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
      financialYearToSet = getFinancialYearFromDate(parsedDate);
    }

    const payload = bodyToIncome(req.body, req.user.id);
    payload.year = financialYearToSet;

    const income = await Income.create(payload);
    await notifyPendingRentalIncome(income, req.user.id);
    res.status(201).json({ success: true, data: mapIncome(income) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get("/", auth, asyncHandler(async (req, res) => {
  const { year, financialYear, category, cropId, page = 1, limit = 20 } = req.query;
  const where = { user_id: req.user.id };
  const fy = financialYear || (year && String(year).includes("-") ? year : null);
  if (fy) {
    // FY stored directly on incomes.year (financialYear like "2025-26").
    where.year = fy;
  } else if (year) {
    // Backward compatibility for numeric `year` (calendar year).
    const yNum = Number(year);
    if (Number.isFinite(yNum)) {
      where.date = { [Op.gte]: `${yNum}-01-01`, [Op.lte]: `${yNum}-12-31` };
    }
  }
  if (category) where.category = category;
  if (cropId) where.crop_id = cropId;

  const { count, rows } = await Income.findAndCountAll({
    where,
    include: [{ model: Crop, as: "Crop", attributes: ["id", "crop_name"], required: false }],
    order: [["date", "DESC"]],
    offset: (Number(page) - 1) * Number(limit),
    limit: Number(limit),
  });
  const data = rows.map((row) => {
    const mapped = mapIncome(row);
    if (row.Crop && mapped.cropId) {
      mapped.cropId = { _id: row.Crop.id, cropName: row.Crop.crop_name };
    }
    return mapped;
  });
  res.json({
    success: true,
    data,
    pagination: { total: count, page: Number(page), limit: Number(limit) },
  });
}));

router.get("/summary", auth, async (req, res) => {
  try {
    const { year, financialYear } = req.query;
    const where = { user_id: req.user.id };
    const fy = financialYear || (year && String(year).includes("-") ? year : null);
    if (fy) {
      where.year = fy;
    } else if (year) {
      const yNum = Number(year);
      if (Number.isFinite(yNum)) {
        where.date = { [Op.gte]: `${yNum}-01-01`, [Op.lte]: `${yNum}-12-31` };
      }
    }

    const rows = await Income.findAll({
      attributes: ["category", [sequelize.fn("SUM", sequelize.col("amount")), "totalAmount"], [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where,
      group: ["category"],
      raw: true,
    });
    const summary = rows.map((r) => ({ _id: r.category, totalAmount: parseFloat(r.totalAmount) || 0, count: parseInt(r.count, 10) }));
    summary.sort((a, b) => b.totalAmount - a.totalAmount);
    const grandTotal = summary.reduce((acc, s) => acc + (s.totalAmount || 0), 0);
    res.json({ success: true, year: fy || year || "all", financialYear: fy || null, summary, grandTotal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/analytics", auth, async (req, res) => {
  try {
    const myProfile = await FarmerProfile.findOne({ where: { user_id: req.user.id }, attributes: ["data_sharing"] });
    if (!myProfile || myProfile.data_sharing !== true) {
      return res.status(403).json({
        success: false,
        message: "Analytics not available. Please enable data sharing in profile.",
      });
    }
    const { year, financialYear, district } = req.query;
    const fy = financialYear || (year && String(year).includes("-") ? year : null);
    // FY is stored directly on incomes.year (financialYear like "2025-26").
    // If FY isn't passed, fall back to calendar-year date filtering.
    const yNum = Number(year) || new Date().getFullYear();
    const dateWhere = fy
      ? { year: fy }
      : { date: { [Op.gte]: `${yNum}-01-01`, [Op.lte]: `${yNum}-12-31` } };

    const mySum = await Income.findOne({
      attributes: [[sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: req.user.id, ...dateWhere },
      raw: true,
    });
    const myTotal = parseFloat(mySum?.total) || 0;

    const consentedProfiles = await FarmerProfile.findAll({
      where: district ? { data_sharing: true, district } : { data_sharing: true },
      attributes: ["user_id"],
    });
    let consentedIds = consentedProfiles.map((p) => p.user_id);

    const allTotals = await Income.findAll({
      attributes: ["user_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: { [Op.in]: consentedIds }, ...dateWhere },
      group: ["user_id"],
      raw: true,
    });
    const totalsArr = allTotals.map((u) => parseFloat(u.total) || 0).sort((a, b) => a - b);
    const avgTotal = totalsArr.length ? +(totalsArr.reduce((a, b) => a + b, 0) / totalsArr.length).toFixed(2) : 0;
    const below = totalsArr.filter((t) => t < myTotal).length;
    const percentileRank = totalsArr.length ? +((below / totalsArr.length) * 100).toFixed(1) : null;

    const topCropRows = await Income.findAll({
      attributes: ["crop_id", [sequelize.fn("SUM", sequelize.col("amount")), "total"]],
      where: { user_id: req.user.id, ...dateWhere, category: "Crop Sale" },
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
      year: fy || yNum,
      financialYear: fy || null,
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

router.post("/:id/send-pending-reminder", auth, async (req, res) => {
  try {
    const income = await Income.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });
    if (!income) {
      return res.status(404).json({ success: false, message: "Income entry not found." });
    }
    const result = await sendPendingTractorReminderPush(income, req.user.id);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({
      success: true,
      sentToTokens: result.sentToTokens ?? 0,
      inAppCreated: result.inAppCreated ?? false,
      message: result.message,
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
    const wasPendingRentalIncome =
      income.category === "Rental Income" && income.rental_income?.paymentStatus === "Pending";
    const { cropId, category, date, notes, cropSale, subsidy, rentalIncome, otherIncome } = req.body;
    if (category !== undefined) income.category = category;
    if (date !== undefined) income.date = date;
    if (notes !== undefined) income.notes = notes;
    if (cropId !== undefined) income.crop_id = cropId;
    if (cropSale !== undefined) income.crop_sale = cropSale;
    if (subsidy !== undefined) income.subsidy = subsidy;
    if (rentalIncome !== undefined) income.rental_income = rentalIncome;
    if (otherIncome !== undefined) income.other_income = otherIncome;

    // Keep FY aligned with crop.year (for crop-linked incomes) or date FY (for general incomes).
    const parsed = date !== undefined ? new Date(date) : (income.date ? new Date(income.date) : new Date());
    if (income.crop_id) {
      const crop = await Crop.findOne({
        where: { user_id: req.user.id, id: income.crop_id },
        attributes: ["year"],
        raw: true,
      });
      if (crop?.year) income.year = crop.year;
    } else {
      income.year = getFinancialYearFromDate(parsed);
    }
    await income.save();
    const isPendingRentalIncome =
      income.category === "Rental Income" && income.rental_income?.paymentStatus === "Pending";
    if (isPendingRentalIncome && !wasPendingRentalIncome) {
      await notifyPendingRentalIncome(income, req.user.id);
    }
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
