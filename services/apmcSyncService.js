const axios = require("axios");
const { ApmcDailyPrice } = require("../models");

const RESOURCE_ID =
  process.env.DATA_GOV_IN_RESOURCE_ID ||
  "9ef84268-d588-465a-a308-a864a43d0070";
const API_KEY = process.env.DATA_GOV_IN_API_KEY || "";
const DATA_GOV_API = "https://data.gov.in/api/datastore/resource.json";
const APMC_TIMEOUT_MS = Number(process.env.APMC_TIMEOUT_MS || 45000);
const APMC_SYNC_LIMIT = Number(process.env.APMC_SYNC_LIMIT || 200);
const APMC_BOOTSTRAP_LIMIT = Number(process.env.APMC_BOOTSTRAP_LIMIT || 50);
const APMC_DISTRICTS = (process.env.APMC_SYNC_DISTRICTS || "Rajkot")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const APMC_STATE = process.env.APMC_SYNC_STATE || "Gujarat";

let lastRunDate = null;

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchDistrictPage({ district, offset = 0, limit = APMC_SYNC_LIMIT }) {
  const params = new URLSearchParams({
    "api-key": API_KEY,
    resource_id: RESOURCE_ID,
    limit: String(limit),
    offset: String(offset),
  });
  params.append("filters[state]", APMC_STATE);
  params.append("filters[district]", district);
  const url = `${DATA_GOV_API}?${params.toString()}`;
  const response = await axios.get(url, { timeout: APMC_TIMEOUT_MS });
  const data = response.data;
  const records = Array.isArray(data?.records) ? data.records : [];
  return records;
}

async function fetchDistrictSample({ district, limit = APMC_BOOTSTRAP_LIMIT }) {
  return fetchDistrictPage({ district, offset: 0, limit });
}

async function syncDistrictForDate(district, snapshotDate) {
  let offset = 0;
  let totalSaved = 0;
  while (true) {
    const records = await fetchDistrictPage({ district, offset });
    if (!records.length) break;
    for (const r of records) {
      const state = r.state || r.State || APMC_STATE;
      const market = r.market || r.Market || "";
      const commodity = r.commodity || r.Commodity || "";
      const variety = r.variety || r.Variety || "";
      if (!market || !commodity) continue;
      await ApmcDailyPrice.upsert({
        snapshot_date: snapshotDate,
        arrival_date: r.arrival_date || r.Arrival_Date || null,
        state,
        district,
        market,
        commodity,
        variety,
        min_price: toNum(r.min_price ?? r.Min_Price),
        max_price: toNum(r.max_price ?? r.Max_Price),
        modal_price: toNum(r.modal_price ?? r.Modal_Price),
        raw_record: r,
      });
      totalSaved += 1;
    }
    if (records.length < APMC_SYNC_LIMIT) break;
    offset += APMC_SYNC_LIMIT;
  }
  return totalSaved;
}

async function syncApmcDailyPrices(runDate = new Date()) {
  if (!API_KEY) {
    console.warn("[APMC Sync] DATA_GOV_IN_API_KEY missing; skipping sync.");
    return { success: false, message: "API key missing", saved: 0 };
  }
  const snapshotDate = runDate.toISOString().slice(0, 10);
  let saved = 0;
  for (const district of APMC_DISTRICTS) {
    const count = await syncDistrictForDate(district, snapshotDate);
    saved += count;
  }
  console.log(`[APMC Sync] Completed for ${snapshotDate}. Rows upserted: ${saved}`);
  return { success: true, snapshotDate, saved };
}

async function bootstrapApmcSnapshot(runDate = new Date()) {
  if (!API_KEY) {
    console.warn("[APMC Bootstrap] DATA_GOV_IN_API_KEY missing; skipping bootstrap.");
    return { success: false, message: "API key missing", saved: 0 };
  }
  const snapshotDate = runDate.toISOString().slice(0, 10);
  let saved = 0;
  for (const district of APMC_DISTRICTS) {
    const records = await fetchDistrictSample({ district });
    for (const r of records) {
      const state = r.state || r.State || APMC_STATE;
      const market = r.market || r.Market || "";
      const commodity = r.commodity || r.Commodity || "";
      const variety = r.variety || r.Variety || "";
      if (!market || !commodity) continue;
      await ApmcDailyPrice.upsert({
        snapshot_date: snapshotDate,
        arrival_date: r.arrival_date || r.Arrival_Date || null,
        state,
        district,
        market,
        commodity,
        variety,
        min_price: toNum(r.min_price ?? r.Min_Price),
        max_price: toNum(r.max_price ?? r.Max_Price),
        modal_price: toNum(r.modal_price ?? r.Modal_Price),
        raw_record: r,
      });
      saved += 1;
    }
  }
  console.log(`[APMC Bootstrap] Completed for ${snapshotDate}. Rows upserted: ${saved}`);
  return { success: true, snapshotDate, saved };
}

function startApmcDailyScheduler() {
  // Check every minute, run once at 00:00 server local time.
  setInterval(async () => {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    if (now.getHours() === 0 && now.getMinutes() === 0 && lastRunDate !== dateKey) {
      try {
        await syncApmcDailyPrices(now);
        lastRunDate = dateKey;
      } catch (e) {
        console.error("[APMC Sync] Scheduler run failed:", e.message);
      }
    }
  }, 60 * 1000);
}

async function getLatestSnapshotDate() {
  const row = await ApmcDailyPrice.findOne({
    attributes: ["snapshot_date"],
    order: [["snapshot_date", "DESC"]],
  });
  return row?.snapshot_date || null;
}

async function getStoredApmcPrices({ state, district, commodity, market, limit = 50, offset = 0 }) {
  const latestDate = await getLatestSnapshotDate();
  if (!latestDate) return { success: true, data: [], count: 0, snapshotDate: null };
  const where = { snapshot_date: latestDate };
  if (state) where.state = state;
  if (district) where.district = district;
  if (commodity) where.commodity = commodity;
  if (market) where.market = market;

  const rows = await ApmcDailyPrice.findAll({
    where,
    order: [
      ["district", "ASC"],
      ["market", "ASC"],
      ["commodity", "ASC"],
    ],
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  return {
    success: true,
    data: rows.map((r) => r.raw_record || {
      state: r.state,
      district: r.district,
      market: r.market,
      commodity: r.commodity,
      variety: r.variety,
      arrival_date: r.arrival_date,
      min_price: r.min_price,
      max_price: r.max_price,
      modal_price: r.modal_price,
    }),
    count: rows.length,
    snapshotDate: latestDate,
  };
}

module.exports = {
  syncApmcDailyPrices,
  bootstrapApmcSnapshot,
  startApmcDailyScheduler,
  getStoredApmcPrices,
  getLatestSnapshotDate,
};

