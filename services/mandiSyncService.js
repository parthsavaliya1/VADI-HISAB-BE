/**
 * Gujarat mandi prices: fetch from api.data.gov.in → PostgreSQL table mandi_prices.
 * Env: DATA_GOV_IN_API_KEY, optional DATA_GOV_IN_RESOURCE_ID, MANDI_TIMEOUT_MS, MANDI_CRON, MANDI_CRON_TZ,
 * MANDI_SYNC_ALL_USE_PER_DISTRICT (see syncMandiAllDistrictsForDate)
 */
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const cron = require("node-cron");
const { MandiPrice } = require("../models");

const RESOURCE_ID =
  process.env.DATA_GOV_IN_RESOURCE_ID ||
  "9ef84268-d588-465a-a308-a864a43d0070";
const API_KEY = process.env.DATA_GOV_IN_API_KEY || "";
const MANDI_API_BASE = "https://api.data.gov.in/resource";
const MANDI_TIMEOUT_MS = Number(process.env.MANDI_TIMEOUT_MS || 120000);
const MANDI_PAGE_LIMIT = Number(process.env.MANDI_PAGE_LIMIT || 1000);
const MANDI_FETCH_RETRIES = Number(process.env.MANDI_FETCH_RETRIES || 3);
const MANDI_INTER_DISTRICT_DELAY_MS = Number(process.env.MANDI_INTER_DISTRICT_DELAY_MS || 400);
const MANDI_SYNC_ALL_MAX = Number(process.env.MANDI_SYNC_ALL_MAX_DISTRICTS || 0);
/** If "true", sync-all loops gujarat-locations.json per district (often 0 rows when names ≠ API). Default: statewide fetch. */
const MANDI_SYNC_ALL_PER_DISTRICT =
  String(process.env.MANDI_SYNC_ALL_USE_PER_DISTRICT || "").toLowerCase() === "true";

function loadGujaratDistrictKeys() {
  try {
    const p = path.join(__dirname, "../data/gujarat-locations.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return Object.keys(j).sort();
  } catch (e) {
    console.warn("[Mandi] Could not load gujarat-locations.json:", e.message);
    return ["Rajkot"];
  }
}

const MONTHS = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

/** API filter + en-GB style: "21/03/2026" */
function formatDdMmYyyy(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "20/03/2026" → "20/Mar/2026" (some data.gov.in resources match this filter better) */
function alternateDdMmYyyyToDdMmmYyyy(ddMmYyyy) {
  const parts = String(ddMmYyyy || "")
    .split("/")
    .map((s) => s.trim());
  if (parts.length !== 3) return null;
  const [d, mPart, y] = parts;
  const mi = Number(mPart);
  if (!Number.isFinite(mi) || mi < 1 || mi > 12) return null;
  return `${String(d).padStart(2, "0")}/${MONTH_ABBR[mi - 1]}/${y}`;
}

/**
 * Parse "21/Mar/2026" or "21/03/2026" → "YYYY-MM-DD" for DATE column; null if invalid.
 */
function parseMandiDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const parts = dateStr.split("/").map((s) => s.trim());
  if (parts.length !== 3) return null;
  const day = parts[0].padStart(2, "0");
  let monthNum;
  if (isNaN(Number(parts[1]))) {
    monthNum = MONTHS[parts[1]];
    if (!monthNum) return null;
  } else {
    monthNum = Number(parts[1]);
  }
  const month = String(monthNum).padStart(2, "0");
  const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
  if (!/^\d{4}$/.test(year)) return null;
  return `${year}-${month}-${day}`;
}

/**
 * Intended DB arrival_date (YYYY-MM-DD). Used to drop API rows whose payload date ≠ requested
 * (data.gov.in often returns mismatched rows vs filters[arrival_date]).
 */
function resolveRequestedArrivalYyyyMmDd(dateInput) {
  if (dateInput != null && String(dateInput).trim() !== "") {
    const s = String(dateInput).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return parseMandiDate(s);
  }
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function filterRecordsMatchingArrivalYyyyMmDd(records, ymd) {
  if (!ymd) return { kept: records, droppedWrongDate: 0 };
  const kept = [];
  let droppedWrongDate = 0;
  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const arrivalRaw = pick(r, "arrival_date", "Arrival_Date", "Arrival Date");
    const parsed = parseMandiDate(String(arrivalRaw || ""));
    if (parsed === ymd) {
      kept.push(r);
    } else {
      droppedWrongDate += 1;
    }
  }
  return { kept, droppedWrongDate };
}

function toNum(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pick(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null && r[k] !== "") return r[k];
  }
  return null;
}

function countRecordsByDistrict(records) {
  const map = {};
  for (let i = 0; i < records.length; i += 1) {
    const d = pick(records[i], "district", "District");
    const key = d != null && String(d).trim() !== "" ? String(d).trim() : "(unknown)";
    map[key] = (map[key] || 0) + 1;
  }
  return map;
}

function distinctArrivalDatesInRecords(records, max = 12) {
  const set = new Set();
  for (let i = 0; i < records.length; i += 1) {
    const raw = pick(records[i], "arrival_date", "Arrival_Date", "Arrival Date");
    if (raw != null) set.add(String(raw).trim());
    if (set.size >= max) break;
  }
  return [...set];
}

async function syncMandiPerDistrictList(filterDdMmYyyy, districts, requestedArrivalYyyyMmDd) {
  let totalFetched = 0;
  let rowsIgnoredOtherArrivalDate = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  const districtResults = [];

  console.log(`[Mandi sync-all] ${filterDdMmYyyy} per-district (${districts.length})…`);

  for (let i = 0; i < districts.length; i += 1) {
    const d = districts[i];
    try {
      const { records } = await fetchGujaratMandiData(filterDdMmYyyy, d);
      const { kept, droppedWrongDate } = filterRecordsMatchingArrivalYyyyMmDd(
        records,
        requestedArrivalYyyyMmDd,
      );
      rowsIgnoredOtherArrivalDate += droppedWrongDate;
      const save = await saveMandiRecords(kept);
      totalFetched += records.length;
      totalInserted += save.inserted;
      totalSkipped += save.skipped;
      districtResults.push({
        district: d,
        fetchedFromApi: records.length,
        savedMatchingDate: save.inserted,
        ignoredOtherArrivalDate: droppedWrongDate,
        skipped: save.skipped,
      });
    } catch (e) {
      districtResults.push({ district: d, error: e.message || String(e) });
    }
    if (i < districts.length - 1 && MANDI_INTER_DISTRICT_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, MANDI_INTER_DISTRICT_DELAY_MS));
    }
  }

  return {
    strategy: "per_district",
    filterDateUsed: filterDdMmYyyy,
    requestedArrivalDate: requestedArrivalYyyyMmDd,
    districtsTried: districts.length,
    totalFetched,
    rowsIgnoredOtherArrivalDate,
    totalInserted,
    totalSkipped,
    districtResults,
  };
}

/**
 * @param {string|null} dateFilterDdMmYyyy - e.g. "21/03/2026" for filters[arrival_date], or null → today (local)
 * @param {string|null} districtFilter - optional e.g. "Rajkot" — narrows API result (sync per district to collect more rows)
 */
async function fetchGujaratMandiData(dateFilterDdMmYyyy = null, districtFilter = null) {
  if (!API_KEY) {
    throw new Error("DATA_GOV_IN_API_KEY is not set in .env");
  }
  const targetDate =
    dateFilterDdMmYyyy ||
    formatDdMmYyyy(new Date());
  const url = `${MANDI_API_BASE}/${RESOURCE_ID}`;
  const allRecords = [];
  let offset = 0;
  let reportedTotal = null;

  while (true) {
    const params = {
      "api-key": API_KEY,
      format: "json",
      limit: MANDI_PAGE_LIMIT,
      offset,
      "filters[state]": "Gujarat",
      "filters[arrival_date]": targetDate,
    };
    if (districtFilter && String(districtFilter).trim()) {
      params["filters[district]"] = String(districtFilter).trim();
    }

    let records = [];
    let lastErr;
    for (let attempt = 0; attempt < MANDI_FETCH_RETRIES; attempt += 1) {
      try {
        const response = await axios.get(url, {
          params,
          timeout: MANDI_TIMEOUT_MS,
          maxRedirects: 5,
          headers: { Accept: "application/json" },
        });
        const data = response.data;
        records = Array.isArray(data?.records) ? data.records : [];
        if (reportedTotal == null && data?.total != null) {
          reportedTotal = Number(data.total);
        }
        break;
      } catch (e) {
        lastErr = e;
        console.warn(
          `[Mandi] fetch attempt ${attempt + 1}/${MANDI_FETCH_RETRIES} failed (offset ${offset}):`,
          e.code || e.message,
        );
        if (attempt < MANDI_FETCH_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        }
      }
    }
    if (records.length === 0) {
      if (offset === 0 && lastErr) throw lastErr;
      break;
    }

    allRecords.push(...records);
    if (records.length < MANDI_PAGE_LIMIT) break;
    offset += MANDI_PAGE_LIMIT;
  }

  return {
    records: allRecords,
    filterDateUsed: targetDate,
    apiReportedTotal: reportedTotal,
  };
}

/**
 * Map API rows → DB rows and upsert (unique includes grade so FAQ/Local/etc. are not overwritten).
 */
async function saveMandiRecords(records) {
  if (!records.length) {
    return { inserted: 0, skipped: 0, errors: [] };
  }

  const errors = [];
  let saved = 0;

  for (let i = 0; i < records.length; i += 1) {
    const r = records[i];
    const district = pick(r, "district", "District");
    const market = pick(r, "market", "Market");
    const commodity = pick(r, "commodity", "Commodity");
    if (!district || !market || !commodity) {
      errors.push({ index: i, error: "missing district, market, or commodity" });
      continue;
    }

    const varietyRaw = pick(r, "variety", "Variety");
    const variety = varietyRaw != null && String(varietyRaw).trim() !== "" ? String(varietyRaw).trim() : null;
    const gradeRaw = pick(r, "grade", "Grade");
    const grade = gradeRaw != null && String(gradeRaw).trim() !== "" ? String(gradeRaw).trim() : null;

    const arrivalRaw = pick(r, "arrival_date", "Arrival_Date", "Arrival Date");
    const arrival_date = parseMandiDate(String(arrivalRaw || ""));
    if (!arrival_date) {
      errors.push({ index: i, error: "invalid or missing arrival_date" });
      continue;
    }

    const row = {
      state: "Gujarat",
      district: String(district).trim(),
      market: String(market).trim(),
      commodity: String(commodity).trim(),
      variety,
      grade,
      arrival_date,
      min_price: toNum(pick(r, "min_price", "Min_Price", "Min Price")),
      max_price: toNum(pick(r, "max_price", "Max_Price", "Max Price")),
      modal_price: toNum(pick(r, "modal_price", "Modal_Price", "Modal Price")),
    };

    try {
      await MandiPrice.upsert(row, {
        conflictFields: ["district", "market", "commodity", "variety", "grade", "arrival_date"],
      });
      saved += 1;
    } catch (e) {
      errors.push({ index: i, error: e.message || String(e) });
    }
  }

  return {
    inserted: saved,
    skipped: errors.length,
    errors: errors.slice(0, 50),
  };
}

/**
 * @param {string|null|object} opts - string date, or null, or { date?: string, district?: string }
 */
async function syncMandiFromDataGov(opts = null) {
  let bodyDate = null;
  let districtFilter = null;
  if (opts != null && typeof opts === "object" && !Array.isArray(opts)) {
    bodyDate = opts.date ?? null;
    districtFilter = opts.district ?? null;
  } else {
    bodyDate = opts;
  }

  let filterDdMmYyyy = null;
  if (bodyDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bodyDate)) {
      const [y, m, d] = bodyDate.split("-");
      filterDdMmYyyy = `${d}/${m}/${y}`;
    } else {
      filterDdMmYyyy = bodyDate;
    }
  }

  const { records, filterDateUsed, apiReportedTotal } = await fetchGujaratMandiData(
    filterDdMmYyyy,
    districtFilter,
  );
  const requestedArrivalDate = resolveRequestedArrivalYyyyMmDd(bodyDate);
  const { kept, droppedWrongDate } = filterRecordsMatchingArrivalYyyyMmDd(
    records,
    requestedArrivalDate,
  );
  const saveResult = await saveMandiRecords(kept);
  return {
    success: true,
    fetched: records.length,
    requestedArrivalDate,
    rowsIgnoredOtherArrivalDate: droppedWrongDate,
    filterDateUsed,
    districtFilter: districtFilter || null,
    apiReportedTotal,
    ...saveResult,
  };
}

/**
 * Sync all Gujarat mandi rows for one arrival_date into mandi_prices.
 * Default: one statewide API query (no filters[district]) + pagination — matches all districts in the dataset.
 * Set MANDI_SYNC_ALL_USE_PER_DISTRICT=true to use the old loop over gujarat-locations.json (often misses rows).
 * @param {{ date?: string }} opts - YYYY-MM-DD or DD/MM/YYYY; omit → today (server local)
 */
async function syncMandiAllDistrictsForDate(opts = {}) {
  if (!API_KEY) {
    throw new Error("DATA_GOV_IN_API_KEY is not set in .env");
  }
  let filterDdMmYyyy = null;
  const date = opts.date ?? null;
  if (date) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d] = date.split("-");
      filterDdMmYyyy = `${d}/${m}/${y}`;
    } else {
      filterDdMmYyyy = date;
    }
  } else {
    filterDdMmYyyy = formatDdMmYyyy(new Date());
  }

  let districts = loadGujaratDistrictKeys().filter((d) => d !== "Other");
  if (MANDI_SYNC_ALL_MAX > 0) {
    districts = districts.slice(0, MANDI_SYNC_ALL_MAX);
  }

  const requestedArrivalDate = resolveRequestedArrivalYyyyMmDd(date);

  if (MANDI_SYNC_ALL_PER_DISTRICT) {
    const out = await syncMandiPerDistrictList(filterDdMmYyyy, districts, requestedArrivalDate);
    return { success: true, ...out };
  }

  console.log(`[Mandi sync-all] ${filterDdMmYyyy} statewide (no district filter)…`);

  let { records, filterDateUsed, apiReportedTotal } = await fetchGujaratMandiData(
    filterDdMmYyyy,
    null,
  );
  if (records.length === 0) {
    const alt = alternateDdMmYyyyToDdMmmYyyy(filterDdMmYyyy);
    if (alt && alt !== filterDdMmYyyy) {
      const second = await fetchGujaratMandiData(alt, null);
      if (second.records.length > 0) {
        records = second.records;
        filterDateUsed = second.filterDateUsed;
        apiReportedTotal = second.apiReportedTotal;
        console.log(`[Mandi sync-all] used alternate date filter: ${alt}`);
      }
    }
  }
  const { kept, droppedWrongDate } = filterRecordsMatchingArrivalYyyyMmDd(
    records,
    requestedArrivalDate,
  );
  const save = await saveMandiRecords(kept);
  const byDistrict = countRecordsByDistrict(kept);
  const districtResults = Object.keys(byDistrict)
    .sort((a, b) => a.localeCompare(b))
    .map((district) => ({
      district,
      fetched: byDistrict[district],
    }));

  const sampleArrivalRaw = distinctArrivalDatesInRecords(kept, 15);
  const sampleArrivalRawUnfiltered = distinctArrivalDatesInRecords(records, 15);

  return {
    success: true,
    strategy: "statewide",
    requestedArrivalDate,
    filterDateUsed,
    apiReportedTotal,
    rowsIgnoredOtherArrivalDate: droppedWrongDate,
    districtsTried: districtResults.length,
    totalFetched: records.length,
    totalInserted: save.inserted,
    totalSkipped: save.skipped,
    districtResults,
    sampleArrivalDatesFromApi: sampleArrivalRaw,
    sampleArrivalDatesBeforeFilter: sampleArrivalRawUnfiltered,
  };
}

function startMandiDailyScheduler() {
  if (!API_KEY) {
    console.warn("[Mandi] DATA_GOV_IN_API_KEY missing; daily mandi cron not scheduled.");
    return;
  }
  const tz = process.env.MANDI_CRON_TZ || "Asia/Kolkata";
  const expression = process.env.MANDI_CRON || "0 9 * * *";
  cron.schedule(
    expression,
    async () => {
      console.log("[Mandi CRON] Syncing Gujarat mandi data…");
      try {
        const out = await syncMandiAllDistrictsForDate({});
        console.log(
          "[Mandi CRON] Done:",
          out.totalFetched,
          "fetched,",
          out.totalInserted,
          "upserted across",
          out.districtsTried,
          "districts",
        );
      } catch (e) {
        console.error("[Mandi CRON] Error:", e.message);
      }
    },
    { timezone: tz },
  );
  console.log(`[Mandi] Daily sync scheduled: "${expression}" (${tz})`);
}

module.exports = {
  fetchGujaratMandiData,
  saveMandiRecords,
  syncMandiFromDataGov,
  syncMandiAllDistrictsForDate,
  parseMandiDate,
  formatDdMmYyyy,
  startMandiDailyScheduler,
};
