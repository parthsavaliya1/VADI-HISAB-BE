require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const cropRoutes = require("./routes/cropRoutes");
const expenseRoutes = require("./routes/expenseRoute");
const incomeRoutes = require("./routes/incomeRoutes");
const vadiScoreRoutes = require("./routes/vadiScoreRoutes");
const serviceLedgerRoutes = require("./routes/serviceLedgerRoutes");
const locationRoutes = require("./routes/locationRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const apmcRoutes = require("./routes/apmcRoutes");
const mandiRoutes = require("./routes/mandiRoutes");
const pushRoutes = require("./routes/pushRoutes");
const storeAdRoutes = require("./routes/storeAdRoutes");
const {
  startApmcDailyScheduler,
  bootstrapApmcSnapshot,
  getLatestSnapshotDate,
} = require("./services/apmcSyncService");
const { startMandiDailyScheduler } = require("./services/mandiSyncService");

const app = express();

app.use(cors());
app.use(express.json());
// Public files for push notification rich images (must be HTTPS + reachable from phones in production)
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/crops", cropRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/income", incomeRoutes);
app.use("/api/vadi-score", vadiScoreRoutes);
app.use("/api/service-ledger", serviceLedgerRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/apmc", apmcRoutes);
app.use("/api/mandi", mandiRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/store-ads", storeAdRoutes);

app.get("/", (req, res) => {
  res.send("Farmer App API Running 🌾");
});

const PORT = process.env.PORT || 8000;

connectDB()
  .then(() => {
    startApmcDailyScheduler();
    startMandiDailyScheduler();
    // On startup, fill APMC snapshot once if table is empty.
    setTimeout(async () => {
      try {
        const latest = await getLatestSnapshotDate();
        if (!latest) {
          await bootstrapApmcSnapshot(new Date());
        }
      } catch (e) {
        console.error("[APMC Bootstrap] startup error:", e.message);
      }
    }, 2000);
    app.listen(PORT, () => {
      console.log("Server running on port", PORT);
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
