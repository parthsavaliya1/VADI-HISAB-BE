require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const cropRoutes = require("./routes/cropRoutes");
const expenseRoutes = require("./routes/expenseRoute");
const incomeRoutes = require("./routes/incomeRoutes");
const serviceLedgerRoutes = require("./routes/serviceLedgerRoutes");
const locationRoutes = require("./routes/locationRoutes");
const notificationRoutes = require("./routes/notificationRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/crops", cropRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/income", incomeRoutes);
app.use("/api/service-ledger", serviceLedgerRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/notifications", notificationRoutes);

app.get("/", (req, res) => {
  res.send("Farmer App API Running 🌾");
});

const PORT = process.env.PORT || 8000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log("Server running on port", PORT);
    });
  })
  .catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
