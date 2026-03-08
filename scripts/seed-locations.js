/**
 * Seed script: reads GUJARAT_LOCATIONS from JSON and inserts into locations table.
 * Run: node scripts/seed-locations.js
 */
require("dotenv").config();
const path = require("path");
const { sequelize, Location } = require("../models");
const data = require("../data/gujarat-locations.json");

async function seed() {
  try {
    await sequelize.authenticate();
    console.log("DB connected");

    await Location.sync({ force: true });
    const rows = [];

    for (const [districtKey, districtData] of Object.entries(data)) {
      rows.push({
        type: "district",
        value: districtKey,
        label: districtData.label,
        district_value: null,
        taluka_value: null,
      });

      for (const [talukaKey, talukaData] of Object.entries(districtData.talukas || {})) {
        rows.push({
          type: "taluka",
          value: talukaKey,
          label: talukaData.label,
          district_value: districtKey,
          taluka_value: null,
        });

        for (const village of talukaData.villages || []) {
          rows.push({
            type: "village",
            value: village.value,
            label: village.label,
            district_value: districtKey,
            taluka_value: talukaKey,
          });
        }
      }
    }

    await Location.bulkCreate(rows);
    console.log(`Seeded ${rows.length} locations (districts, talukas, villages)`);
    process.exit(0);
  } catch (err) {
    console.error("Seed failed:", err);
    process.exit(1);
  }
}

seed();
