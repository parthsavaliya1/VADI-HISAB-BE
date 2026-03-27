const express = require("express");
const { Op } = require("sequelize");
const { StoreAd, mapStoreAd } = require("../models");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function isAdmin(req) {
  return req.user?.role === "admin";
}

function parseBool(value) {
  return String(value).toLowerCase() === "true";
}

// GET /api/store-ads?placement=dashboard
// By default returns currently active ads only.
router.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const {
      placement = "dashboard",
      includeInactive = "false",
      includeScheduled = "false",
      page = 1,
      limit = 20,
    } = req.query;

    const now = new Date();
    const where = {};
    if (placement) where.placement = String(placement);

    const allowAll = isAdmin(req) && parseBool(includeInactive);
    if (!allowAll) where.status = "Active";

    if (!parseBool(includeScheduled)) {
      where[Op.and] = [
        { [Op.or]: [{ starts_at: null }, { starts_at: { [Op.lte]: now } }] },
        { [Op.or]: [{ ends_at: null }, { ends_at: { [Op.gte]: now } }] },
      ];
    }

    const { count, rows } = await StoreAd.findAndCountAll({
      where,
      order: [
        ["sort_order", "ASC"],
        ["created_at", "DESC"],
      ],
      offset: (Number(page) - 1) * Number(limit),
      limit: Number(limit),
    });

    return res.json({
      success: true,
      data: rows.map((row) => mapStoreAd(row)),
      pagination: {
        total: count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(count / Number(limit)),
      },
    });
  })
);

// POST /api/store-ads (admin)
router.post(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Only admin can create advertisements." });
    }

    const {
      title,
      subtitle,
      mediaType = "image",
      mediaUrl,
      thumbnailUrl,
      redirectUrl,
      placement = "dashboard",
      status = "Active",
      sortOrder = 0,
      startsAt,
      endsAt,
      meta = {},
    } = req.body;

    if (!title || !mediaUrl) {
      return res.status(400).json({ success: false, message: "title and mediaUrl are required." });
    }
    if (!["image", "video"].includes(mediaType)) {
      return res.status(400).json({ success: false, message: "mediaType must be image or video." });
    }

    const row = await StoreAd.create({
      title: String(title),
      subtitle: subtitle ?? null,
      media_type: mediaType,
      media_url: String(mediaUrl),
      thumbnail_url: thumbnailUrl ?? null,
      redirect_url: redirectUrl ?? null,
      placement: String(placement),
      status: String(status),
      sort_order: Number(sortOrder) || 0,
      starts_at: startsAt ?? null,
      ends_at: endsAt ?? null,
      meta: meta ?? {},
    });

    return res.status(201).json({ success: true, data: mapStoreAd(row) });
  })
);

// PATCH /api/store-ads/:id (admin)
router.patch(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Only admin can update advertisements." });
    }

    const { id } = req.params;
    const ad = await StoreAd.findByPk(id);
    if (!ad) {
      return res.status(404).json({ success: false, message: "Advertisement not found." });
    }

    const {
      title,
      subtitle,
      mediaType,
      mediaUrl,
      thumbnailUrl,
      redirectUrl,
      placement,
      status,
      sortOrder,
      startsAt,
      endsAt,
      meta,
    } = req.body;

    const updatePayload = {};
    if (title !== undefined) updatePayload.title = String(title);
    if (subtitle !== undefined) updatePayload.subtitle = subtitle ?? null;
    if (mediaType !== undefined) {
      if (!["image", "video"].includes(mediaType)) {
        return res.status(400).json({ success: false, message: "mediaType must be image or video." });
      }
      updatePayload.media_type = String(mediaType);
    }
    if (mediaUrl !== undefined) updatePayload.media_url = String(mediaUrl);
    if (thumbnailUrl !== undefined) updatePayload.thumbnail_url = thumbnailUrl ?? null;
    if (redirectUrl !== undefined) updatePayload.redirect_url = redirectUrl ?? null;
    if (placement !== undefined) updatePayload.placement = String(placement);
    if (status !== undefined) updatePayload.status = String(status);
    if (sortOrder !== undefined) updatePayload.sort_order = Number(sortOrder) || 0;
    if (startsAt !== undefined) updatePayload.starts_at = startsAt ?? null;
    if (endsAt !== undefined) updatePayload.ends_at = endsAt ?? null;
    if (meta !== undefined) updatePayload.meta = meta ?? {};

    // Keep existing required fields if not provided
    await ad.update(updatePayload);

    return res.json({ success: true, data: mapStoreAd(ad) });
  })
);

// DELETE /api/store-ads/:id (admin)
router.delete(
  "/:id",
  auth,
  asyncHandler(async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: "Only admin can delete advertisements." });
    }

    const { id } = req.params;
    const deleted = await StoreAd.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Advertisement not found." });
    }

    return res.json({ success: true, message: "Advertisement deleted." });
  })
);

module.exports = router;
