const axios = require("axios");
const { Op } = require("sequelize");
const { PushToken, Notification } = require("../models");

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Rich notification image URL for Expo push. Must be a direct image URL (HTTPS, returns image bytes).
 * ImgBB / Dropbox "share" pages do not work — use "direct link" or host via PUBLIC_BASE_URL + /notification-logo.png.
 */
function resolveNotificationImageUrl(imageUrlOpt) {
  if (typeof imageUrlOpt === "string" && imageUrlOpt.trim()) {
    return imageUrlOpt.trim();
  }
  const explicit = process.env.EXPO_PUSH_NOTIFICATION_IMAGE_URL;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  const base = process.env.PUBLIC_BASE_URL;
  if (typeof base === "string" && base.trim()) {
    const root = base.trim().replace(/\/$/, "");
    return `${root}/notification-logo.png`;
  }
  return null;
}

/**
 * Sends Expo push notifications to all active tokens for the given user IDs.
 * @param {string[]} userIds
 * @param {{ title: string; body: string; data?: object; sound?: string; saveInApp?: boolean; imageUrl?: string }} opts
 *   imageUrl — optional HTTPS URL of a full-color image (e.g. Vadi logo). Sent as richContent.image; Android shows it in the notification. Falls back to EXPO_PUSH_NOTIFICATION_IMAGE_URL.
 * @returns {Promise<{ ok: boolean; reason?: string; sentToTokens: number; tickets?: unknown[] }>}
 */
async function sendExpoPushToUserIds(userIds, opts) {
  const {
    title,
    body,
    data = {},
    sound = "default",
    saveInApp = true,
    imageUrl: imageUrlOpt,
  } = opts || {};
  const imageUrl = resolveNotificationImageUrl(imageUrlOpt);
  if (!title || !body) {
    return { ok: false, reason: "missing_title_body", sentToTokens: 0 };
  }

  const uniq = [...new Set((userIds || []).filter(Boolean))];
  if (!uniq.length) {
    return { ok: false, reason: "no_users", sentToTokens: 0 };
  }

  const activeTokens = await PushToken.findAll({
    where: { user_id: { [Op.in]: uniq }, is_active: true },
  });

  if (!activeTokens.length) {
    return { ok: false, reason: "no_tokens", sentToTokens: 0 };
  }

  const messages = activeTokens.map((row) => {
    const msg = {
      to: row.token,
      sound,
      title,
      body,
      priority: "high",
      channelId: "default",
      data: data || {},
    };
    if (imageUrl) {
      msg.richContent = { image: imageUrl };
    }
    return msg;
  });

  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  const tickets = [];
  for (const chunk of chunks) {
    const response = await axios.post(EXPO_PUSH_API_URL, chunk, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });
    if (Array.isArray(response.data?.data)) tickets.push(...response.data.data);
  }

  if (saveInApp) {
    await Promise.all(
      uniq.map((userId) =>
        Notification.create({
          user_id: userId,
          type: "Push",
          title,
          message: body,
          meta: data || {},
        })
      )
    );
  }

  return { ok: true, sentToTokens: activeTokens.length, tickets };
}

module.exports = { sendExpoPushToUserIds };
