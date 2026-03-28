require("dotenv").config();
const { Sequelize } = require("sequelize");

const dbUrl = process.env.DATABASE_URL || process.env.PG_URI;

if (!dbUrl) {
  console.error("Missing DATABASE_URL or PG_URI in .env");
  process.exit(1);
}

const isSupabaseHost = /supabase\.co|pooler\.supabase\.com/i.test(dbUrl);

const sequelize = new Sequelize(dbUrl, {
  dialect: "postgres",
  logging: process.env.NODE_ENV === "development" ? console.log : false,
  // Supabase Postgres requires TLS over the public internet.
  ...(isSupabaseHost
    ? {
        dialectOptions: {
          ssl: { require: true, rejectUnauthorized: false },
        },
      }
    : {}),

  define: {
    underscored: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
});

module.exports = { sequelize, Sequelize };
