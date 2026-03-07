/**
 * Run a SQL migration file. Usage: node scripts/run-migration.js migrations/crop-year-to-financial-year.sql
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sequelize } = require("../models");

const file = process.argv[2] || "migrations/crop-year-to-financial-year.sql";
const filePath = path.resolve(process.cwd(), file);

if (!fs.existsSync(filePath)) {
  console.error("File not found:", filePath);
  process.exit(1);
}

const sql = fs.readFileSync(filePath, "utf8");

sequelize
  .query(sql)
  .then(() => {
    console.log("Migration ran successfully:", file);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed:", err.message);
    process.exit(1);
  });
