const { FarmerProfile, Notification, User } = require("../models");

function normalizePhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function formatAmount(amount) {
  const value = Number(amount) || 0;
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

async function findUserByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;
  return User.findOne({ where: { phone: normalizedPhone } });
}

async function createPendingTractorChargeNotification({
  recipientUserId,
  providerUserId,
  sourceType,
  sourceId,
  assetType,
  amount,
  serviceDate,
}) {
  if (!recipientUserId || !providerUserId || recipientUserId === providerUserId) return null;

  const providerProfile = await FarmerProfile.findOne({
    where: { user_id: providerUserId },
    attributes: ["name"],
  });

  const providerName = providerProfile?.name?.trim() || "Farmer";
  const serviceLabel = assetType || "Tractor";
  const amountText = formatAmount(amount);

  return Notification.create({
    user_id: recipientUserId,
    type: "Pending Tractor Charge",
    title: "ટ્રેક્ટર ના પૈસા બાકી છે",
    message: `${providerName} એ ${serviceLabel} માટે ₹${amountText} નો બાકી ચાર્જ ઉમેર્યો છે.`,
    reference_type: sourceType,
    reference_id: sourceId,
    meta: {
      providerUserId,
      assetType: serviceLabel,
      amount: Number(amount) || 0,
      serviceDate: serviceDate || null,
    },
  });
}

module.exports = {
  createPendingTractorChargeNotification,
  findUserByPhone,
  normalizePhone,
};
