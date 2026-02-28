require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const cropRoutes = require("./routes/cropRoutes");
const expenseRoutes = require("./routes/expenseRoute");
const incomeRoutes = require("./routes/incomeRoutes");

const app = express();

connectDB();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/crops", cropRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/income", incomeRoutes);

app.get("/", (req, res) => {
  res.send("Farmer App API Running 🌾");
});

app.listen(8000, () => {
  console.log("Server running on port 8000");
});
