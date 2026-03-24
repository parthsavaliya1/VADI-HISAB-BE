/**
 * APMC / Mandi live crop price proxy.
 * Fetches from Government of India's data.gov.in (AGMARKNET source).
 * Set DATA_GOV_IN_API_KEY in .env (get from https://data.gov.in → Register → My Account).
 * Optional: DATA_GOV_IN_RESOURCE_ID (default is mandi daily price resource).
 */
const express = require("express");
const axios = require("axios");
const auth = require("../middleware/authMiddleware");
const {
  getStoredApmcPrices,
  syncApmcDailyPrices,
  getLatestSnapshotDate,
} = require("../services/apmcSyncService");

const router = express.Router();

const RESOURCE_ID =
  process.env.DATA_GOV_IN_RESOURCE_ID ||
  "9ef84268-d588-465a-a308-a864a43d0070";
const API_KEY = process.env.DATA_GOV_IN_API_KEY || "";
const DATA_GOV_API = "https://data.gov.in/api/datastore";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// data.gov.in can be slow; avoid frequent repeat calls from the app UI
const APMC_TIMEOUT_MS = Number(process.env.APMC_TIMEOUT_MS || 45000);
const APMC_CACHE_TTL_MS = Number(process.env.APMC_CACHE_TTL_MS || 5 * 60 * 1000); // 5 minutes
const apmcCache = new Map(); // key=url -> { ts, payload }
const getCached = (key) => {
  const v = apmcCache.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > APMC_CACHE_TTL_MS) {
    apmcCache.delete(key);
    return null;
  }
  return v.payload;
};
const setCached = (key, payload) => {
  apmcCache.set(key, { ts: Date.now(), payload });
};

/**
 * GET /api/apmc/prices
 * Query: state, district, commodity, market, limit (default 50), offset (default 0)
 * Proxies to data.gov.in and returns records with Arrival_Date, State, District, Market, Commodity, Variety, Min_Price, Max_Price, Modal_Price.
 */
router.get(
  "/prices",
  auth,
  asyncHandler(async (req, res) => {
    if (!API_KEY) {
      return res.status(503).json({
        success: false,
        message:
          "APMC price API not configured. Set DATA_GOV_IN_API_KEY in server .env (get key from data.gov.in).",
      });
    }
    const { state, district, commodity, market, limit = 50, offset = 0 } = req.query;

    // Primary source: DB snapshot (fast, reliable).
    const stored = await getStoredApmcPrices({
      state,
      district,
      commodity,
      market,
      limit,
      offset,
    });
    if ((stored?.count || 0) > 0) {
      return res.json({
        ...stored,
        source: "db",
      });
    }

    // DB-only response path (no live API call in request path).
    const payload = {
      success: true,
      data: [],
      count: 0,
      source: "db-empty",
      message: "APMC snapshot not ready yet. Trigger /api/apmc/sync-now or wait for startup bootstrap/night scheduler.",
    };
    return res.json(payload);
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
    const result = await syncApmcDailyPrices(new Date());
    const snapshotDate = await getLatestSnapshotDate();
    res.json({ success: true, ...result, snapshotDate });
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
