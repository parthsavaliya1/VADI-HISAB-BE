const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const { ApmcDailyPrice } = require("../models");

const RESOURCE_ID =
  process.env.DATA_GOV_IN_RESOURCE_ID ||
  "9ef84268-d588-465a-a308-a864a43d0070";
const API_KEY = process.env.DATA_GOV_IN_API_KEY || "";
const DATA_GOV_API = "https://data.gov.in/api/datastore/resource.json";
/** data.gov.in is often slow; allow override via .env */
const APMC_TIMEOUT_MS = Number(process.env.APMC_TIMEOUT_MS || 120000);
const APMC_FETCH_RETRIES = Number(process.env.APMC_FETCH_RETRIES || 4);
const APMC_SYNC_LIMIT = Number(process.env.APMC_SYNC_LIMIT || 200);
const APMC_BOOTSTRAP_LIMIT = Number(process.env.APMC_BOOTSTRAP_LIMIT || 50);
const APMC_STATE = process.env.APMC_SYNC_STATE || "Gujarat";
/** Pause between finishing one district and starting the next (data.gov.in rate limits). */
const APMC_INTER_DISTRICT_DELAY_MS = Number(
  process.env.APMC_INTER_DISTRICT_DELAY_MS || 400,
);

function loadGujaratDistrictKeys() {
  try {
    const p = path.join(__dirname, "../data/gujarat-locations.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.keys(j).sort();
  } catch (e) {
    console.warn("[APMC Sync] Could not load gujarat-locations.json:", e.message);
    return ["Rajkot"];
  }
}

const rawDistricts = (process.env.APMC_SYNC_DISTRICTS || "ALL").trim();
const APMC_DISTRICTS =
  rawDistricts.toUpperCase() === "ALL"
    ? loadGujaratDistrictKeys()
    : rawDistricts
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

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
  let lastErr;
  for (let attempt = 0; attempt < APMC_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await axios.get(url, {
        timeout: APMC_TIMEOUT_MS,
        maxRedirects: 5,
        headers: { Accept: "application/json" },
      });
      const data = response.data;
      const records = Array.isArray(data?.records) ? data.records : [];
      return records;
    } catch (e) {
      lastErr = e;
      const why = e.code || e.message;
      console.warn(
        `[APMC Sync] HTTP attempt ${attempt + 1}/${APMC_FETCH_RETRIES} failed (${district}, offset ${offset}): ${why}`,
      );
      if (attempt < APMC_FETCH_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
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
  console.log(
    `[APMC Sync] Starting ${snapshotDate} for ${APMC_DISTRICTS.length} district(s)…`,
  );
  for (let i = 0; i < APMC_DISTRICTS.length; i += 1) {
    const district = APMC_DISTRICTS[i];
    const count = await syncDistrictForDate(district, snapshotDate);
    saved += count;
    if (i < APMC_DISTRICTS.length - 1 && APMC_INTER_DISTRICT_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, APMC_INTER_DISTRICT_DELAY_MS));
    }
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
  for (let i = 0; i < APMC_DISTRICTS.length; i += 1) {
    const district = APMC_DISTRICTS[i];
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
    if (i < APMC_DISTRICTS.length - 1 && APMC_INTER_DISTRICT_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, APMC_INTER_DISTRICT_DELAY_MS));
    }
  }
  console.log(`[APMC Bootstrap] Completed for ${snapshotDate}. Rows upserted: ${saved}`);
  return { success: true, snapshotDate, saved };
}

/**
 * Daily job: pull mandi prices from data.gov.in into PostgreSQL once.
 * Default 06:00 Asia/Kolkata. Override with APMC_CRON (5-field cron) and optional APMC_CRON_TZ.
 */
function startApmcDailyScheduler() {
  const tz = process.env.APMC_CRON_TZ || "Asia/Kolkata";
  const expression = process.env.APMC_CRON || "0 6 * * *";
  cron.schedule(
    expression,
    async () => {
      try {
        await syncApmcDailyPrices(new Date());
      } catch (e) {
        console.error("[APMC Sync] Cron run failed:", e.message);
      }
    },
    { timezone: tz },
  );
  console.log(`[APMC] Daily sync scheduled: "${expression}" (${tz})`);
}

async function getLatestSnapshotDate() {
  const row = await ApmcDailyPrice.findOne({
    attributes: ["snapshot_date"],
    order: [["snapshot_date", "DESC"]],
  });
  return row?.snapshot_date || null;
}

/** Latest snapshot row date for a given state + district (ignores other districts). */
async function getLatestSnapshotDateForFilter({ state, district }) {
  const where = {};
  if (state) where.state = state;
  if (district) where.district = district;
  const row = await ApmcDailyPrice.findOne({
    where,
    order: [["snapshot_date", "DESC"]],
    attributes: ["snapshot_date"],
  });
  return row?.snapshot_date || null;
}

function parseArrivalQuintal(raw) {
  if (!raw || typeof raw !== "object") return 0;
  const keys = [
    "Arrival",
    "arrival",
    "Arrival_Quantity",
    "Arrivals",
    "arrival_quantity",
    "Quantity_Arrived",
    "quantity_arrived",
  ];
  for (const k of keys) {
    const v = raw[k];
    if (v == null || v === "") continue;
    const n = Number(String(v).replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function quintalTo20kgRs(rsPerQuintal) {
  if (rsPerQuintal == null || !Number.isFinite(Number(rsPerQuintal))) return null;
  return Math.round(Number(rsPerQuintal) / 5);
}

/**
 * District daily bulletin: one row per commodity + variety (aggregated across mandis).
 */
async function getApmcBulletin({ state, district, snapshotDate }) {
  if (!snapshotDate) {
    return { success: true, data: [], count: 0, snapshotDate: null };
  }
  const where = { snapshot_date: snapshotDate };
  if (state) where.state = state;
  if (district) where.district = district;

  const rows = await ApmcDailyPrice.findAll({
    where,
    order: [
      ["commodity", "ASC"],
      ["variety", "ASC"],
      ["market", "ASC"],
    ],
    limit: Number(process.env.APMC_BULLETIN_ROW_CAP || 8000),
  });

  const map = new Map();
  for (const row of rows) {
    const plain = row.get({ plain: true });
    const commodity = String(plain.commodity || "").trim();
    const variety = String(plain.variety || "").trim();
    if (!commodity) continue;
    const key = `${commodity}\u0000${variety}`;
    const raw = plain.raw_record || {};
    const addArrival = parseArrivalQuintal(raw);
    const minP = toNum(plain.min_price);
    const maxP = toNum(plain.max_price);

    const cur = map.get(key) || {
      commodity,
      variety,
      arrival_quintal: 0,
      min_q: null,
      max_q: null,
    };
    cur.arrival_quintal += addArrival;
    if (minP != null) cur.min_q = cur.min_q == null ? minP : Math.min(cur.min_q, minP);
    if (maxP != null) cur.max_q = cur.max_q == null ? maxP : Math.max(cur.max_q, maxP);
    map.set(key, cur);
  }

  const data = [...map.values()]
    .map((r) => {
      const name = [r.commodity, r.variety].filter(Boolean).join(" · ");
      return {
        commodity: r.commodity,
        variety: r.variety,
        name,
        arrival_quintal: Math.round(r.arrival_quintal * 100) / 100,
        min_price_quintal: r.min_q,
        max_price_quintal: r.max_q,
        min_price_per_20kg: quintalTo20kgRs(r.min_q),
        max_price_per_20kg: quintalTo20kgRs(r.max_q),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  return {
    success: true,
    data,
    count: data.length,
    snapshotDate,
  };
}

async function getDistinctSnapshotDates({ state, district, limit = 120 }) {
  const where = {};
  if (state) where.state = state;
  if (district) where.district = district;
  const lim = Math.min(Number(limit) || 120, 400);
  const rows = await ApmcDailyPrice.findAll({
    attributes: ["snapshot_date"],
    where,
    group: ["snapshot_date"],
    order: [["snapshot_date", "DESC"]],
    limit: lim,
  });
  return rows.map((r) => r.snapshot_date).filter(Boolean);
}

async function getStoredApmcPrices({
  state,
  district,
  commodity,
  market,
  limit = 50,
  offset = 0,
  date = null,
}) {
  let snapshotDate = date || null;
  if (!snapshotDate) {
    if (state && district) {
      snapshotDate = await getLatestSnapshotDateForFilter({ state, district });
    }
    if (!snapshotDate) snapshotDate = await getLatestSnapshotDate();
  }
  if (!snapshotDate) return { success: true, data: [], count: 0, snapshotDate: null };

  const where = { snapshot_date: snapshotDate };
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
    data: rows.map((r) =>
      r.raw_record
        ? r.raw_record
        : {
            state: r.state,
            district: r.district,
            market: r.market,
            commodity: r.commodity,
            variety: r.variety,
            arrival_date: r.arrival_date,
            min_price: r.min_price,
            max_price: r.max_price,
            modal_price: r.modal_price,
          },
    ),
    count: rows.length,
    snapshotDate,
  };
}

const APMC_MANUAL_IMPORT_MAX = Number(process.env.APMC_MANUAL_IMPORT_MAX || 500);

/**
 * Insert or update rows from Postman / admin (no data.gov.in).
 * Unique key: snapshot_date + state + district + market + commodity + variety.
 */
async function ingestManualApmcRecords({ snapshotDate, records, defaultState = "Gujarat" }) {
  if (!snapshotDate || typeof snapshotDate !== "string") {
    return { success: false, message: "snapshotDate (YYYY-MM-DD) is required", saved: 0, errors: [] };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { success: false, message: "records must be a non-empty array", saved: 0, errors: [] };
  }
  if (records.length > APMC_MANUAL_IMPORT_MAX) {
    return {
      success: false,
      message: `Too many rows (max ${APMC_MANUAL_IMPORT_MAX}). Split into multiple requests or set APMC_MANUAL_IMPORT_MAX.`,
      saved: 0,
      errors: [],
    };
  }

  let saved = 0;
  const errors = [];

  for (let i = 0; i < records.length; i += 1) {
    const row = records[i] || {};
    const state = row.state || defaultState;
    const district = row.district;
    const market = row.market;
    const commodity = row.commodity;
    if (!district || !market || !commodity) {
      errors.push({ index: i, error: "district, market, and commodity are required" });
      continue;
    }
    const variety =
      row.variety != null && String(row.variety).trim() !== "" ? String(row.variety).trim() : "";
    const raw =
      row.raw_record && typeof row.raw_record === "object" && !Array.isArray(row.raw_record)
        ? row.raw_record
        : { source: "manual_import", ...row };

    try {
      await ApmcDailyPrice.upsert({
        snapshot_date: snapshotDate,
        arrival_date: row.arrival_date || row.Arrival_Date || null,
        state,
        district,
        market,
        commodity,
        variety,
        min_price: toNum(row.min_price ?? row.Min_Price),
        max_price: toNum(row.max_price ?? row.Max_Price),
        modal_price: toNum(row.modal_price ?? row.Modal_Price),
        raw_record: raw,
      });
      saved += 1;
    } catch (e) {
      errors.push({ index: i, error: e.message || String(e) });
    }
  }

  return {
    success: saved > 0,
    saved,
    failed: errors.length,
    errors,
    snapshotDate,
  };
}

module.exports = {
  syncApmcDailyPrices,
  bootstrapApmcSnapshot,
  startApmcDailyScheduler,
  getStoredApmcPrices,
  getLatestSnapshotDate,
  getLatestSnapshotDateForFilter,
  getApmcBulletin,
  getDistinctSnapshotDates,
  ingestManualApmcRecords,
};

