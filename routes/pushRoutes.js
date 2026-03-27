const express = require("express");
const { PushToken, User } = require("../models");
const auth = require("../middleware/authMiddleware");
const { sendExpoPushToUserIds } = require("../utils/expoPushSend");

const router = express.Router();

const EXPO_TOKEN_REGEX = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const normalizePlatform = (platform) => {
  const value = String(platform || "").toLowerCase();
  if (value === "ios" || value === "android") return value;
  return "unknown";
};

router.post(
  "/register-token",
  auth,
  asyncHandler(async (req, res) => {
    const { token, platform } = req.body || {};
    const trimmedToken = String(token || "").trim();

    if (!EXPO_TOKEN_REGEX.test(trimmedToken)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Expo push token.",
      });
    }

    const normalizedPlatform = normalizePlatform(platform);
    const existing = await PushToken.findOne({
      where: { user_id: req.user.id, token: trimmedToken },
    });

    if (existing) {
      await existing.update({
        is_active: true,
        platform: normalizedPlatform,
        last_seen_at: new Date(),
      });
      return res.json({ success: true, message: "Push token updated." });
    }

    await PushToken.create({
      user_id: req.user.id,
      token: trimmedToken,
      platform: normalizedPlatform,
      is_active: true,
      last_seen_at: new Date(),
    });

    res.json({ success: true, message: "Push token registered." });
  })
);

router.post(
  "/send",
  auth,
  asyncHandler(async (req, res) => {
    const {
      title,
      body,
      data,
      userIds,
      sendToAll = false,
      sound = "default",
      saveInApp = true,
    } = req.body || {};

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "title and body are required.",
      });
    }

    // Token currently guarantees user id; fetch role from DB for authorization.
    if (sendToAll) {
      const currentUser = await User.findByPk(req.user.id, { attributes: ["id", "role"] });
      if (!currentUser || currentUser.role !== "admin") {
        return res.status(403).json({
          success: false,
          message: "Only admin users can send broadcast notifications.",
        });
      }
    }

    let targetUserIds;
    if (sendToAll) {
      const allActiveRows = await PushToken.findAll({
        where: { is_active: true },
        attributes: ["user_id"],
      });
      targetUserIds = [...new Set(allActiveRows.map((row) => row.user_id))];
    } else {
      targetUserIds =
        Array.isArray(userIds) && userIds.length ? userIds : [req.user.id];
    }

    if (!targetUserIds.length) {
      return res.status(404).json({
        success: false,
        message: "No users found with active push tokens.",
      });
    }

    const pushResult = await sendExpoPushToUserIds(targetUserIds, {
      title,
      body,
      data: data || {},
      sound,
      saveInApp,
    });

    if (!pushResult.ok) {
      return res.status(404).json({
        success: false,
        message: "No active push tokens found for target users.",
      });
    }

    res.json({
      success: true,
      sentToTokens: pushResult.sentToTokens,
      targetUsers: [...new Set(targetUserIds)].length,
      tickets: pushResult.tickets,
    });
  })
);

module.exports = router;
