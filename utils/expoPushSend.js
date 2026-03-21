const axios = require("axios");
const { Op } = require("sequelize");
const { PushToken, Notification } = require("../models");

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

/**
 * Sends Expo push notifications to all active tokens for the given user IDs.
 * @param {string[]} userIds
 * @param {{ title: string; body: string; data?: object; sound?: string; saveInApp?: boolean }} opts
 * @returns {Promise<{ ok: boolean; reason?: string; sentToTokens: number; tickets?: unknown[] }>}
 */
async function sendExpoPushToUserIds(userIds, opts) {
  const { title, body, data = {}, sound = "default", saveInApp = true } = opts || {};
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

  const messages = activeTokens.map((row) => ({
    to: row.token,
    sound,
    title,
    body,
    priority: "high",
    channelId: "default",
    data: data || {},
  }));

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
