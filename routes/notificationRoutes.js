const express = require("express");
const { Notification, mapNotification } = require("../models");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

router.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, unreadOnly } = req.query;
    const where = { user_id: req.user.id };
    if (String(unreadOnly) === "true") where.is_read = false;

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [["created_at", "DESC"]],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });

    const unreadCount = await Notification.count({
      where: { user_id: req.user.id, is_read: false },
    });

    res.json({
      success: true,
      data: rows.map((row) => mapNotification(row)),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
        unreadCount,
      },
    });
  })
);

router.patch(
  "/read-all",
  auth,
  asyncHandler(async (req, res) => {
    const readAt = new Date();
    await Notification.update(
      { is_read: true, read_at: readAt },
      { where: { user_id: req.user.id, is_read: false } }
    );

    res.json({ success: true, message: "All notifications marked as read." });
  })
);

router.patch(
  "/:id/read",
  auth,
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOne({
      where: { id: req.params.id, user_id: req.user.id },
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    if (!notification.is_read) {
      await notification.update({ is_read: true, read_at: new Date() });
    }

    res.json({ success: true, data: mapNotification(notification) });
  })
);

module.exports = router;
