/**
 * One-shot APMC sync: pull data.gov.in → PostgreSQL apmc_daily_prices.
 * Usage (from VADI-HISAB-BE): node scripts/sync-apmc-once.js
 * Requires: DATA_GOV_IN_API_KEY in .env
 * Optional env: APMC_SYNC_DISTRICTS=Rajkot or ALL (default in service)
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const connectDB = require("../config/db");
const { syncApmcDailyPrices, getLatestSnapshotDate } = require("../services/apmcSyncService");

async function main() {
  if (!process.env.DATA_GOV_IN_API_KEY) {
    console.error(
      "[sync-apmc] Missing DATA_GOV_IN_API_KEY in .env — get a key from https://data.gov.in (Register → My Account).",
    );
    process.exit(1);
  }
  await connectDB();
  console.log("[sync-apmc] Starting sync…");
  const result = await syncApmcDailyPrices(new Date());
  const latest = await getLatestSnapshotDate();
  console.log("[sync-apmc] Result:", JSON.stringify({ ...result, latestSnapshotInDb: latest }));
  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  console.error("[sync-apmc] Failed:", e.message);
  if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(String(e.code || e.message))) {
    console.error(
      "[sync-apmc] data.gov.in did not respond in time. Set APMC_TIMEOUT_MS=180000 (or higher) in .env, or run this script from a server with a stable route to India (e.g. cloud VPS).",
    );
  }
  process.exit(1);
});
