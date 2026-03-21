const { FarmerProfile, Notification, User } = require("../models");
const { sendExpoPushToUserIds } = require("./expoPushSend");

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

/**
 * Manual reminder from tractor income list: in-app notification + Expo push to the farmer
 * (farmer must be a VADI user with the same phone as saved on the entry).
 */
async function sendPendingTractorReminderPush(incomeRow, providerUserId) {
  const rentalIncome = incomeRow?.rental_income;
  if (!rentalIncome || incomeRow.category !== "Rental Income") {
    return { success: false, message: "આ ટ્રેક્ટર ભાડાની એન્ટ્રી નથી." };
  }
  if (rentalIncome.paymentStatus !== "Pending") {
    return { success: false, message: "બાકી નથી — સૂચના મોકલી શકાતી નથી." };
  }
  if (!normalizePhone(rentalIncome.farmerPhone)) {
    return {
      success: false,
      message: "પહેલા ખેડૂતનો મોબાઇલ નંબર એન્ટ્રીમાં ઉમેરો (સુધારો ખોલીને).",
    };
  }

  const recipient = await findUserByPhone(rentalIncome.farmerPhone);
  if (!recipient) {
    return {
      success: false,
      message:
        "આ નંબર પર વાડી એપનું ખાતું નથી — ખેડૂતે પોતાના નંબરથી એપમાં લૉગિન કરવું પડશે.",
    };
  }
  if (String(recipient.id) === String(providerUserId)) {
    return { success: false, message: "સ્વતઃ પોતાને સૂચના મોકલી શકાતી નથી." };
  }

  const notif = await createPendingTractorChargeNotification({
    recipientUserId: recipient.id,
    providerUserId,
    sourceType: "Income",
    sourceId: incomeRow.id,
    assetType: rentalIncome.assetType,
    amount: incomeRow.amount ?? rentalIncome.hoursOrDays * rentalIncome.ratePerUnit,
    serviceDate: incomeRow.date,
  });

  if (!notif) {
    return { success: false, message: "સૂચના બનાવી શકાઈ નહીં." };
  }

  const pushResult = await sendExpoPushToUserIds([recipient.id], {
    title: notif.title,
    body: notif.message,
    data: {
      type: "pending_tractor_charge",
      referenceType: "Income",
      referenceId: String(incomeRow.id),
    },
    saveInApp: false,
  });

  if (!pushResult.ok && pushResult.reason === "no_tokens") {
    return {
      success: true,
      sentToTokens: 0,
      inAppCreated: true,
      message:
        "સૂચના એપમાં સાચવાઈ, પણ પુશ મળ્યો નહીં — ખેડૂતે એપ ચાલુ રાખી પુશ ચાલુ કરવું.",
    };
  }

  if (!pushResult.ok) {
    return {
      success: true,
      sentToTokens: 0,
      inAppCreated: true,
      message: "સૂચના એપમાં સાચવાઈ.",
    };
  }

  return {
    success: true,
    sentToTokens: pushResult.sentToTokens,
    inAppCreated: true,
    message: "સૂચના મોકલાઈ.",
  };
}

module.exports = {
  createPendingTractorChargeNotification,
  findUserByPhone,
  normalizePhone,
  sendPendingTractorReminderPush,
};
