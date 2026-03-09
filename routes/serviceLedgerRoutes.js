const express = require("express");
const router = express.Router();
const { ServiceLedger, User, mapRow } = require("../models");
const auth = require("../middleware/authMiddleware");
const { Op } = require("sequelize");
const { createPendingTractorChargeNotification } = require("../utils/notificationHelpers");

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function mapLedger(row) {
  const o = mapRow(row);
  if (!o) return o;
  o.providerId = o.providerId ?? row.provider_id;
  o.customerFarmerId = o.customerFarmerId ?? row.customer_farmer_id;
  o.serviceType = o.serviceType ?? row.service_type;
  o.areaBigha = o.areaBigha ?? row.area_bigha;
  o.ratePerBigha = o.ratePerBigha ?? row.rate_per_bigha;
  o.totalAmount = o.totalAmount ?? row.total_amount;
  o.paymentStatus = o.paymentStatus ?? row.payment_status;
  o.linkedExpenseId = o.linkedExpenseId ?? row.linked_expense_id;
  return o;
}

async function notifyPendingServiceLedger(entry, providerUserId) {
  if (!entry || entry.payment_status !== "Pending") return;

  await createPendingTractorChargeNotification({
    recipientUserId: entry.customer_farmer_id,
    providerUserId,
    sourceType: "ServiceLedger",
    sourceId: entry.id,
    assetType: entry.service_type,
    amount: entry.total_amount,
    serviceDate: entry.date,
  });
}

router.post(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { customerFarmerId, serviceType, areaBigha, ratePerBigha, paymentStatus, date, notes, linkedExpenseId } = req.body;
    if (!customerFarmerId || !serviceType || areaBigha == null || ratePerBigha == null) {
      return res.status(400).json({
        success: false,
        message: "customerFarmerId, serviceType, areaBigha, and ratePerBigha are required.",
      });
    }
    const entry = await ServiceLedger.create({
      provider_id: req.user.id,
      customer_farmer_id: customerFarmerId,
      service_type: serviceType,
      area_bigha: Number(areaBigha),
      rate_per_bigha: Number(ratePerBigha),
      payment_status: paymentStatus ?? "Pending",
      date: date ? new Date(date) : new Date(),
      notes: notes ?? "",
      linked_expense_id: linkedExpenseId ?? null,
    });
    await notifyPendingServiceLedger(entry, req.user.id);
    res.status(201).json({ success: true, data: mapLedger(entry) });
  })
);

router.get(
  "/work-done",
  auth,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, paymentStatus } = req.query;
    const where = { provider_id: req.user.id };
    if (paymentStatus) where.payment_status = paymentStatus;
    const { count, rows } = await ServiceLedger.findAndCountAll({
      where,
      include: [{ model: User, as: "Customer", attributes: ["id", "phone"], required: false }],
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });
    const data = rows.map((r) => {
      const o = mapLedger(r);
      if (r.Customer) o.customerFarmerId = { _id: r.Customer.id, phone: r.Customer.phone };
      return o;
    });
    res.json({
      success: true,
      data,
      pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / Number(limit)) },
    });
  })
);

router.get(
  "/work-taken",
  auth,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, paymentStatus } = req.query;
    const where = { customer_farmer_id: req.user.id };
    if (paymentStatus) where.payment_status = paymentStatus;
    const { count, rows } = await ServiceLedger.findAndCountAll({
      where,
      include: [{ model: User, as: "Provider", attributes: ["id", "phone"], required: false }],
      order: [["date", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });
    const data = rows.map((r) => {
      const o = mapLedger(r);
      if (r.Provider) o.providerId = { _id: r.Provider.id, phone: r.Provider.phone };
      return o;
    });
    res.json({
      success: true,
      data,
      pagination: { total: count, page: Number(page), limit: Number(limit), totalPages: Math.ceil(count / Number(limit)) },
    });
  })
);

router.get(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const entry = await ServiceLedger.findOne({
      where: {
        id: req.params.id,
        [Op.or]: [{ provider_id: req.user.id }, { customer_farmer_id: req.user.id }],
      },
      include: [
        { model: User, as: "Provider", attributes: ["id", "phone"] },
        { model: User, as: "Customer", attributes: ["id", "phone"] },
      ],
    });
    if (!entry) return res.status(404).json({ success: false, message: "Service entry not found." });
    const o = mapLedger(entry);
    if (entry.Provider) o.providerId = { _id: entry.Provider.id, phone: entry.Provider.phone };
    if (entry.Customer) o.customerFarmerId = { _id: entry.Customer.id, phone: entry.Customer.phone };
    res.json({ success: true, data: o });
  })
);

router.patch(
  "/:id/payment",
  auth,
  asyncHandler(async (req, res) => {
    const { paymentStatus } = req.body;
    if (!["Pending", "Paid"].includes(paymentStatus)) {
      return res.status(400).json({ success: false, message: "paymentStatus must be Pending or Paid." });
    }
    const entry = await ServiceLedger.findOne({
      where: {
        id: req.params.id,
        [Op.or]: [{ provider_id: req.user.id }, { customer_farmer_id: req.user.id }],
      },
    });
    if (!entry) return res.status(404).json({ success: false, message: "Service entry not found." });
    const wasPending = entry.payment_status === "Pending";
    await entry.update({ payment_status: paymentStatus });
    if (paymentStatus === "Pending" && !wasPending) {
      await notifyPendingServiceLedger(entry, entry.provider_id);
    }
    res.json({ success: true, data: mapLedger(entry) });
  })
);

router.patch(
  "/:id/link-expense",
  auth,
  asyncHandler(async (req, res) => {
    const { linkedExpenseId } = req.body;
    const entry = await ServiceLedger.findOne({
      where: { id: req.params.id, customer_farmer_id: req.user.id },
    });
    if (!entry) return res.status(404).json({ success: false, message: "Service entry not found." });
    await entry.update({ linked_expense_id: linkedExpenseId || null });
    res.json({ success: true, data: mapLedger(entry) });
  })
);

router.delete(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    const entry = await ServiceLedger.findOne({
      where: { id: req.params.id, provider_id: req.user.id },
    });
    if (!entry) return res.status(404).json({ success: false, message: "Service entry not found." });
    await entry.destroy();
    res.json({ success: true, message: "Service entry deleted successfully." });
  })
);

module.exports = router;
