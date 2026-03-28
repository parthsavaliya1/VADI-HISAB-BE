const axios = require("axios");

const LIST_STATE_URL =
  process.env.AGMARKNET_LIST_STATE_URL ||
  "https://api.agmarknet.gov.in/v1/list-state";
const MARKET_REPORT_DAILY_URL =
  process.env.AGMARKNET_MARKET_REPORT_DAILY_URL ||
  "https://api.agmarknet.gov.in/v1/prices-and-arrivals/market-report/daily";
const TIMEOUT_MS = Number(process.env.AGMARKNET_TIMEOUT_MS || 120000);
const MAX_STATE_IDS = Number(process.env.AGMARKNET_MAX_STATE_IDS || 40);
const MAX_MARKET_IDS_PER_REPORT = Number(
  process.env.AGMARKNET_MAX_MARKET_IDS_PER_REPORT || 40
);

/** Substrings in mkt_name (lowercase) for Kathiawar / Saurashtra APMCs — avoids North & Central Gujarat. */
const SAURASHTRA_MKT_INCLUDES = [
  "jamnagar",
  "rajkot",
  "morbi",
  "gondal",
  "dwarka",
  "dwaraka",
  "surendranagar",
  "wadhvan",
  "wadhwan",
  "porbandar",
  "junagadh",
  "amreli",
  "bhavnagar",
  "botad",
  "veraval",
  "kodinar",
  "mahuva",
  "palitana",
  "upleta",
  "jasdan",
  "dhoraji",
  "wankaner",
  "jetpur",
  "kutiyana",
  "mangrol",
  "keshod",
  "visavadar",
  "talala",
  "savarkundla",
  "rajula",
  "dhari",
  "babra",
  "bagasara",
  "sami",
  "halvad",
  "chotila",
  "limbdi",
  "limdi",
  "sayala",
  "gogha",
  "talaja",
  "sihor",
  "khambhalia",
  "okha",
  "bhanvad",
  "kalawad",
  "thangadh",
  "vinchhiya",
  "chuda",
  "sutrapada",
  "manavadar",
  "lathi",
  "ranpur",
  "vyra",
  "songadh",
  "valod",
];

/** Whole-word tokens (lowercase) — substring match would false-positive elsewhere. */
const SAURASHTRA_MKT_WORDS = ["una"];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function marketNameIsSaurashtra(mktName) {
  if (!mktName || typeof mktName !== "string") return false;
  const lower = mktName.toLowerCase();
  for (const s of SAURASHTRA_MKT_INCLUDES) {
    if (lower.includes(s)) return true;
  }
  for (const w of SAURASHTRA_MKT_WORDS) {
    const re = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(w)}([^a-z0-9]|$)`,
      "i"
    );
    if (re.test(mktName)) return true;
  }
  return false;
}

/**
 * Keeps only markets whose mkt_name matches Saurashtra (Kathiawar) region.
 * @param {object|object[]} data Raw list-state payload
 * @param {"saurashtra"|"all"} region
 * @returns {{ list: object[], marketsBefore: number, marketsAfter: number }}
 */
function filterListStateByRegion(data, region) {
  const list = Array.isArray(data) ? data : data != null ? [data] : [];
  if (region !== "saurashtra") {
    let marketsBefore = 0;
    for (const st of list) {
      marketsBefore += (st.markets || []).length;
    }
    return { list, marketsBefore, marketsAfter: marketsBefore };
  }
  let marketsBefore = 0;
  let marketsAfter = 0;
  const out = list.map((st) => {
    const markets = Array.isArray(st.markets) ? st.markets : [];
    marketsBefore += markets.length;
    const filtered = markets.filter((m) =>
      marketNameIsSaurashtra(m.mkt_name || "")
    );
    marketsAfter += filtered.length;
    return { ...st, markets: filtered };
  });
  return { list: out, marketsBefore, marketsAfter };
}

function normalizeStateIds(input) {
  if (input == null) return [11];
  const arr = Array.isArray(input) ? input : [input];
  const ids = arr
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 1_000_000);
  return ids;
}

/**
 * POST to AGMARKNET list-state: markets and commodities per state.
 * @param {number[]} stateIds
 * @returns {Promise<object[]>} API root is usually an array of { state_id, state_name, markets }
 */
async function fetchListState(stateIds) {
  const ids = normalizeStateIds(stateIds);
  if (!ids.length) {
    const err = new Error("stateIds must be a non-empty array of positive integers");
    err.status = 400;
    throw err;
  }
  if (ids.length > MAX_STATE_IDS) {
    const err = new Error(`At most ${MAX_STATE_IDS} state ids allowed`);
    err.status = 400;
    throw err;
  }

  const response = await axios.post(LIST_STATE_URL, { stateIds: ids }, {
    timeout: TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    validateStatus: () => true,
  });

  const { data, status } = response;
  if (status < 200 || status >= 300) {
    const msg =
      typeof data === "object" && data?.detail
        ? String(data.detail)
        : `AGMARKNET HTTP ${status}`;
    const err = new Error(msg);
    err.status = status >= 400 && status < 600 ? status : 502;
    err.upstream = data;
    throw err;
  }

  if (typeof data === "object" && data !== null && "detail" in data && typeof data.detail === "string") {
    const err = new Error(data.detail);
    err.status = 502;
    err.upstream = data;
    throw err;
  }

  return data;
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

function titleForMarketReportDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return `Market-wise, Commodity-wise Daily Report on ${d}/${m}/${y}`;
}

function normalizeMarketIds(input) {
  const arr = Array.isArray(input) ? input : input != null ? [input] : [];
  const ids = arr
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 1_000_000_000);
  return [...new Set(ids)];
}

/**
 * POST AGMARKNET daily market-wise commodity report for selected mandis.
 * @param {{ date: string, marketIds: number[], stateIds?: number[], includeExcel?: boolean }} opts
 */
async function fetchMarketReportDaily(opts) {
  const date = typeof opts?.date === "string" ? opts.date.trim() : "";
  if (!DATE_ISO.test(date)) {
    const err = new Error('date must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  const marketIds = normalizeMarketIds(opts?.marketIds);
  if (!marketIds.length) {
    const err = new Error("marketIds must be a non-empty array of positive integers");
    err.status = 400;
    throw err;
  }
  if (marketIds.length > MAX_MARKET_IDS_PER_REPORT) {
    const err = new Error(
      `At most ${MAX_MARKET_IDS_PER_REPORT} market ids per request`
    );
    err.status = 400;
    throw err;
  }
  const stateIds = normalizeStateIds(opts?.stateIds);
  if (!stateIds.length) {
    const err = new Error("stateIds resolved empty");
    err.status = 400;
    throw err;
  }
  const includeExcel = Boolean(opts?.includeExcel);

  const payload = {
    date,
    State: stateIds,
    stateIds,
    marketIds,
    includeExcel,
    title: titleForMarketReportDate(date),
  };

  const response = await axios.post(MARKET_REPORT_DAILY_URL, payload, {
    timeout: TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    validateStatus: () => true,
  });

  const { data, status } = response;
  if (status < 200 || status >= 300) {
    const msg =
      typeof data === "object" && data?.detail
        ? String(data.detail)
        : typeof data === "object" && data?.message
          ? String(data.message)
          : `AGMARKNET HTTP ${status}`;
    const err = new Error(msg);
    err.status = status >= 400 && status < 600 ? status : 502;
    err.upstream = data;
    throw err;
  }

  if (typeof data === "object" && data !== null && data.success === false) {
    const err = new Error(
      typeof data.message === "string" ? data.message : "AGMARKNET report failed"
    );
    err.status = 502;
    err.upstream = data;
    throw err;
  }

  if (typeof data === "object" && data !== null && "detail" in data && typeof data.detail === "string") {
    const err = new Error(data.detail);
    err.status = 502;
    err.upstream = data;
    throw err;
  }

  return data;
}

module.exports = {
  fetchListState,
  fetchMarketReportDaily,
  filterListStateByRegion,
  marketNameIsSaurashtra,
  normalizeStateIds,
  LIST_STATE_URL,
  MARKET_REPORT_DAILY_URL,
};
