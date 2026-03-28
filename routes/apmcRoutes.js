/**
 * APMC / Mandi live crop price proxy.
 * Fetches from Government of India's data.gov.in (AGMARKNET source).
 * Set DATA_GOV_IN_API_KEY in .env (get from https://data.gov.in → Register → My Account).
 * Optional: DATA_GOV_IN_RESOURCE_ID (default is mandi daily price resource).
 */
const express = require("express");
const auth = require("../middleware/authMiddleware");
const { Income, Crop } = require("../models");
const { getFinancialYearFromDate } = require("../utils/financialYear");
const {
  getStoredApmcPrices,
  syncApmcDailyPrices,
  getLatestSnapshotDate,
  getApmcBulletin,
  getDistinctSnapshotDates,
  getLatestSnapshotDateForFilter,
  ingestManualApmcRecords,
} = require("../services/apmcSyncService");

const router = express.Router();

const API_KEY = process.env.DATA_GOV_IN_API_KEY || "";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

async function getUserSaleFallback(userId, selectedCommodity) {
  const fy = getFinancialYearFromDate(new Date());
  const rows = await Income.findAll({
    where: {
      user_id: userId,
      category: "Crop Sale",
      year: fy,
    },
    include: [{ model: Crop, attributes: ["crop_name"], required: false }],
    order: [["date", "DESC"]],
    limit: 60,
  });

  const mapped = rows
    .map((r) => {
      const sale = r.crop_sale || {};
      const cropName = r.Crop?.crop_name || "";
      const pricePerKg = Number(sale.pricePerKg ?? sale.pricePerUnit ?? 0);
      const marketName = sale.marketName || sale.market || "તમારો વેચાણ ભાવ";
      if (!cropName || !(pricePerKg > 0)) return null;
      const modalPricePerQuintal = +(pricePerKg * 100).toFixed(2);
      return {
        state: "Gujarat",
        district: "Local",
        market: marketName,
        commodity: cropName,
        variety: sale.variety || "",
        arrival_date: r.date || null,
        min_price: modalPricePerQuintal,
        max_price: modalPricePerQuintal,
        modal_price: modalPricePerQuintal,
      };
    })
    .filter(Boolean);

  const filtered = selectedCommodity
    ? mapped.filter((m) => String(m.commodity).toLowerCase() === String(selectedCommodity).toLowerCase())
    : mapped;

  return filtered;
}

/**
 * GET /api/apmc/prices
 * Query: state, district, commodity, market, limit (default 50), offset (default 0)
 * Reads latest daily snapshot from PostgreSQL (filled by cron + data.gov.in). No live call per request.
 */
/**
 * GET /api/apmc/snapshot-dates?state=Gujarat&district=Rajkot
 * Dates that have APMC rows for this district (newest first).
 */
router.get(
  "/snapshot-dates",
  auth,
  asyncHandler(async (req, res) => {
    const state = req.query.state || "Gujarat";
    const district = req.query.district;
    if (!district) {
      return res.status(400).json({ success: false, message: "district is required" });
    }
    const data = await getDistinctSnapshotDates({ state, district });
    res.json({ success: true, data });
  }),
);

/**
 * GET /api/apmc/bulletin?state=Gujarat&district=Rajkot&date=2026-03-21
 * All crops for one district + snapshot day (aggregated across mandis).
 */
router.get(
  "/bulletin",
  auth,
  asyncHandler(async (req, res) => {
    const state = req.query.state || "Gujarat";
    const district = req.query.district;
    if (!district) {
      return res.status(400).json({ success: false, message: "district is required" });
    }
    let date = req.query.date || null;
    if (!date) {
      date = await getLatestSnapshotDateForFilter({ state, district });
    }
    if (!date) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        snapshotDate: null,
        message: "No APMC snapshot for this district yet. Run sync on the server.",
      });
    }
    const out = await getApmcBulletin({ state, district, snapshotDate: date });
    res.json({ ...out, source: "db-bulletin" });
  }),
);

router.get(
  "/prices",
  auth,
  asyncHandler(async (req, res) => {
    const { state, district, commodity, market, limit = 50, offset = 0, date } = req.query;

    // Primary source: DB snapshot (no data.gov.in call per request; API key only needed for sync).
    const stored = await getStoredApmcPrices({
      state,
      district,
      commodity,
      market,
      limit,
      offset,
      date,
    });
    if ((stored?.count || 0) > 0) {
      return res.json({
        ...stored,
        source: "db",
      });
    }

    // Fallback when snapshot is empty: show user's recent crop-sale derived rates.
    const userFallback = await getUserSaleFallback(req.user.id, commodity);
    if (userFallback.length > 0) {
      return res.json({
        success: true,
        data: userFallback.slice(Number(offset) || 0, (Number(offset) || 0) + Math.min(Number(limit) || 50, 100)),
        count: userFallback.length,
        source: "user-sales-fallback",
        message: "APMC snapshot not ready; showing your recent crop sale rates.",
      });
    }

    return res.json({
      success: true,
      data: [],
      count: 0,
      source: "db-empty",
      message: "APMC snapshot not ready yet. Trigger /api/apmc/sync-now or wait for startup bootstrap/night scheduler.",
    });
  })
);

/**
 * POST /api/apmc/sync-now
 * Manual snapshot trigger (for admin/testing) to save today's APMC data in DB.
 */
router.post(
  "/sync-now",
  auth,
  asyncHandler(async (req, res) => {
    if (!API_KEY) {
      return res.status(503).json({
        success: false,
        message:
          "Sync requires DATA_GOV_IN_API_KEY in server .env (get key from data.gov.in).",
      });
    }
    const result = await syncApmcDailyPrices(new Date());
    const snapshotDate = await getLatestSnapshotDate();
    res.json({ success: true, ...result, snapshotDate });
  })
);

/**
 * POST /api/apmc/manual
 * Body: { snapshotDate: "YYYY-MM-DD", records: [...] }
 * Optional: state (default Gujarat), or per-row state.
 * Upserts by snapshot + state + district + market + commodity + variety.
 */
router.post(
  "/manual",
  auth,
  asyncHandler(async (req, res) => {
    const snapshotDate = req.body.snapshotDate || req.body.snapshot_date;
    const records = req.body.records || req.body.rows;
    const defaultState = req.body.state || "Gujarat";
    if (!snapshotDate || !Array.isArray(records)) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid body. Send JSON: { \"snapshotDate\": \"2026-03-28\", \"records\": [ { \"district\", \"market\", \"commodity\", ... } ] }",
      });
    }
    const out = await ingestManualApmcRecords({
      snapshotDate,
      records,
      defaultState,
    });
    if (!out.success && out.saved === 0 && (out.errors?.length || out.message)) {
      return res.status(400).json(out);
    }
    res.json({ success: true, ...out });
  })
);

/**
 * GET /api/apmc/commodities
 * Returns list of distinct commodities (optional: from a small sample or static list).
 * data.gov.in may not expose a distinct list; we return a common set for dropdowns.
 */
const COMMON_COMMODITIES = [
  "Cotton", "Groundnut", "Jeera", "Garlic", "Onion", "Chana", "Wheat", "Bajra", "Maize",
  "Tomato", "Potato", "Brinjal", "Cabbage", "Cauliflower", "Green Chilli", "Rice", "Jowar",
  "Tur", "Urad", "Moong", "Soybean", "Mustard", "Sesamum", "Copra", "Sugarcane", "Paddy",
];
router.get(
  "/commodities",
  auth,
  (req, res) => {
    res.json({ success: true, data: COMMON_COMMODITIES });
  }
);

module.exports = router;
