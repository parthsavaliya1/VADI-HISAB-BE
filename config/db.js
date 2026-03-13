// PostgreSQL + Sequelize only (no Mongoose). If you see "mongoose" in errors, run: rm -rf node_modules package-lock.json && npm install
const { sequelize } = require("../models");

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log("PostgreSQL connected");
    //this is for postgres
    //    await sequelize.sync({ alter: true });
    // Auto-sync: creates tables if missing, alters existing tables to match models (e.g. after DB reset)
    await sequelize.sync();
    console.log("Database synced");
  } catch (error) {
    console.error("DB error:", error);
    process.exit(1);
  }
};

module.exports = connectDB;
