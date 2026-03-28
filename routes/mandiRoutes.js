/**
 * Mandi prices from mandi_prices (api.data.gov.in sync).
 * POST /api/mandi/sync — body: { date?: "DD/MM/YYYY" | "YYYY-MM-DD" }
 * GET  /api/mandi?date=YYYY-MM-DD&district=&commodity=
 * GET  /api/mandi/dates
 * GET  /api/mandi/districts
 */
const express = require("express");
const { Op } = require("sequelize");
const auth = require("../middleware/authMiddleware");
const { MandiPrice, sequelize, Sequelize } = require("../models");
const { syncMandiFromDataGov, syncMandiAllDistrictsForDate } = require("../services/mandiSyncService");

const router = express.Router();
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.post(
  "/sync",
  auth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    try {
      const result = await syncMandiFromDataGov({
        date: body.date ?? null,
        district: body.district ?? null,
      });
      res.json(result);
    } catch (e) {
      console.error("[Mandi sync]", e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  }),
);

/**
 * POST /api/mandi/sync-all
 * Body: { date?: "YYYY-MM-DD" } — statewide Gujarat + arrival_date (no per-district filter), paginated.
 * Optional .env: MANDI_SYNC_ALL_USE_PER_DISTRICT=true restores old JSON district loop (often ~26 rows only).
 * Use long Postman timeout if the dataset is large.
 */
router.post(
  "/sync-all",
  auth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    try {
      const result = await syncMandiAllDistrictsForDate({ date: body.date ?? null });
      res.json(result);
    } catch (e) {
      console.error("[Mandi sync-all]", e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  }),
);

/** GET /api/mandi/markets?date=YYYY-MM-DD&district=Rajkot — distinct markets for that day + district */
router.get(
  "/markets",
  auth,
  asyncHandler(async (req, res) => {
    const { date, district } = req.query;
    if (!date || !district) {
      return res.status(400).json({
        success: false,
        error: "date and district query params are required",
      });
    }
    const rows = await sequelize.query(
      `SELECT DISTINCT market FROM mandi_prices WHERE arrival_date = :date AND district ILIKE :district ORDER BY market ASC NULLS LAST`,
      {
        replacements: { date, district },
        type: Sequelize.QueryTypes.SELECT,
      },
    );
    const markets = rows.map((r) => r.market).filter(Boolean);
    res.json({ success: true, markets });
  }),
);

router.get(
  "/",
  auth,
  asyncHandler(async (req, res) => {
    const { date, district, commodity, market } = req.query;
    if (!date) {
      return res.status(400).json({ success: false, error: "date is required (YYYY-MM-DD)" });
    }

    const where = { arrival_date: date };
    if (district) where.district = { [Op.iLike]: district };
    if (market) where.market = { [Op.iLike]: market };
    if (commodity) where.commodity = { [Op.iLike]: `%${commodity}%` };

    const rows = await MandiPrice.findAll({
      where,
      order: [
        ["commodity", "ASC"],
        ["market", "ASC"],
      ],
      limit: 5000,
    });

    const data = rows.map((r) => r.get({ plain: true }));
    res.json({ success: true, count: data.length, data });
  }),
);

router.get(
  "/dates",
  auth,
  asyncHandler(async (req, res) => {
    const rows = await sequelize.query(
      `SELECT DISTINCT arrival_date FROM mandi_prices ORDER BY arrival_date DESC NULLS LAST`,
      { type: Sequelize.QueryTypes.SELECT },
    );
    const dates = rows.map((r) => r.arrival_date).filter(Boolean);
    res.json({ success: true, dates });
  }),
);

router.get(
  "/districts",
  auth,
  asyncHandler(async (req, res) => {
    const rows = await sequelize.query(
      `SELECT DISTINCT district FROM mandi_prices ORDER BY district ASC NULLS LAST`,
      { type: Sequelize.QueryTypes.SELECT },
    );
    const districts = rows.map((r) => r.district).filter(Boolean);
    res.json({ success: true, districts });
  }),
);

module.exports = router;
