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
} = require("../services/apmcSyncService");
const {
  fetchListState,
  fetchMarketReportDaily,
  filterListStateByRegion,
} = require("../services/agmarknetService");

const AGMARKNET_DEFAULT_REGION =
  String(process.env.AGMARKNET_DEFAULT_REGION || "saurashtra").toLowerCase() ===
  "all"
    ? "all"
    : "saurashtra";

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

/**
 * POST /api/apmc/agmarknet/list-state
 * Proxies AGMARKNET v1 list-state (markets + commodities per state).
 * Body: { stateIds?: number[], region?: "saurashtra" | "all" }
 * — stateIds defaults to [11] (Gujarat); region defaults to saurashtra (Kathiawar markets only).
 * Set region "all" for every Gujarat market. Override default with env AGMARKNET_DEFAULT_REGION=all.
 */
router.post(
  "/agmarknet/list-state",
  auth,
  async (req, res) => {
    try {
      const rawRegion = req.body?.region;
      const region =
        rawRegion == null || rawRegion === ""
          ? AGMARKNET_DEFAULT_REGION
          : String(rawRegion).toLowerCase() === "all"
            ? "all"
            : "saurashtra";

      const data = await fetchListState(req.body?.stateIds);
      const { list, marketsBefore, marketsAfter } = filterListStateByRegion(
        data,
        region
      );
      res.json({
        success: true,
        data: list,
        count: list.length,
        region,
        marketsBefore,
        marketsAfter,
      });
    } catch (e) {
      const status =
        e.status && e.status >= 400 && e.status < 600
          ? e.status
          : e.response?.status >= 400 && e.response?.status < 600
            ? e.response.status
            : 502;
      res.status(status).json({
        success: false,
        message: e.message || "AGMARKNET list-state failed",
      });
    }
  }
);

/**
 * POST /api/apmc/agmarknet/market-report/daily
 * AGMARKNET market-wise daily prices for selected mandi(s).
 * Body: { date: "YYYY-MM-DD", marketIds: number[], stateIds?: number[], includeExcel?: boolean }
 */
router.post(
  "/agmarknet/market-report/daily",
  auth,
  async (req, res) => {
    try {
      const body = req.body || {};
      const data = await fetchMarketReportDaily({
        date: body.date,
        marketIds: body.marketIds,
        stateIds: body.stateIds,
        includeExcel: body.includeExcel,
      });
      res.json({ success: true, data });
    } catch (e) {
      const status =
        e.status && e.status >= 400 && e.status < 600
          ? e.status
          : e.response?.status >= 400 && e.response?.status < 600
            ? e.response.status
            : 502;
      res.status(status).json({
        success: false,
        message: e.message || "AGMARKNET market-report daily failed",
      });
    }
  }
);

module.exports = router;
