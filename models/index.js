const { sequelize, Sequelize } = require("../config/database");
const { getFinancialYearFromDate } = require("../utils/financialYear");

// ─── Helper: ensure API responses include _id for compatibility with existing app ──
function toApiShape(row) {
  if (!row) return row;
  const data = row.get ? row.get({ plain: true }) : row;
  return { ...data, _id: data.id };
}

// ─── User ───────────────────────────────────────────────────────────────────────
const User = sequelize.define(
  "User",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    phone: { type: Sequelize.STRING(15), allowNull: false, unique: true },
    role: { type: Sequelize.STRING(20), defaultValue: "farmer" },
    is_profile_completed: { type: Sequelize.BOOLEAN, defaultValue: false },
    /** @deprecated Use FarmerProfile.data_sharing; kept for backward compat / migration */
    analytics_consent: { type: Sequelize.BOOLEAN, defaultValue: null },
    last_active_at: { type: Sequelize.DATE, defaultValue: null },
  },
  { tableName: "users" }
);

// ─── FarmerProfile ────────────────────────────────────────────────────────────
const FarmerProfile = sequelize.define(
  "FarmerProfile",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, unique: true, references: { model: "users", key: "id" } },
    name: { type: Sequelize.STRING(120), allowNull: false },
    district: { type: Sequelize.STRING(50), allowNull: false },
    taluka: { type: Sequelize.STRING(80), allowNull: false },
    village: { type: Sequelize.STRING(80), allowNull: false },
    total_land_value: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
    total_land_unit: { type: Sequelize.STRING(10), defaultValue: "bigha" },
    water_sources: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
    tractor_available: { type: Sequelize.BOOLEAN, allowNull: false },
    implements_available: { type: Sequelize.JSONB, defaultValue: [] },
    labour_types: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
    /** Farms with name and area in bigha: [{ name: "vadi", area: 30 }, ...] */
    farms: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
    /** Data sharing / analytics consent: null = not set, true/false = user choice (moved from users.analytics_consent) */
    data_sharing: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: null },
  },
  { tableName: "farmer_profiles" }
);

User.hasOne(FarmerProfile, { foreignKey: "user_id" });
FarmerProfile.belongsTo(User, { foreignKey: "user_id" });

// ─── Crop ─────────────────────────────────────────────────────────────────────
const Crop = sequelize.define(
  "Crop",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    season: { type: Sequelize.STRING(20), allowNull: false },
    /** Financial year June–June e.g. "2025-26" (June 2025 to May 2026) */
    year: { type: Sequelize.STRING(10), allowNull: false },
    crop_name: { type: Sequelize.STRING(50), allowNull: false },
    crop_emoji: { type: Sequelize.STRING(10), defaultValue: "🌱" },
    sub_type: { type: Sequelize.STRING(100), defaultValue: "" },
    batch_label: { type: Sequelize.STRING(50), defaultValue: "" },
    /** Farm name from profile (e.g. "vadi", "farm-2") for area validation */
    farm_name: { type: Sequelize.STRING(80), allowNull: true, defaultValue: null },
    area: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
    area_unit: { type: Sequelize.STRING(20), defaultValue: "Bigha" },
    /** "ghare" = own land, "bhagma" = sharecropping; when bhagma, bhagma_percentage is set (25, 30, 33, 50) */
    land_type: { type: Sequelize.STRING(20), allowNull: true, defaultValue: null },
    bhagma_percentage: { type: Sequelize.INTEGER, allowNull: true, defaultValue: null },
    sowing_date: { type: Sequelize.DATEONLY, defaultValue: null },
    harvest_date: { type: Sequelize.DATEONLY, defaultValue: null },
    status: { type: Sequelize.STRING(20), defaultValue: "Active" },
    expected_yield_kg: { type: Sequelize.DECIMAL(12, 2), defaultValue: null },
    actual_yield_kg: { type: Sequelize.DECIMAL(12, 2), defaultValue: null },
    notes: { type: Sequelize.STRING(500), defaultValue: "" },
  },
  {
    tableName: "crops",
    getterMethods: {
      yieldEfficiency() {
        const exp = parseFloat(this.expected_yield_kg);
        const act = parseFloat(this.actual_yield_kg);
        if (exp && act && exp > 0) return +((act / exp) * 100).toFixed(1);
        return null;
      },
    },
  }
);

User.hasMany(Crop, { foreignKey: "user_id" });
Crop.belongsTo(User, { foreignKey: "user_id" });

// ─── Income ────────────────────────────────────────────────────────────────────
const Income = sequelize.define(
  "Income",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    crop_id: { type: Sequelize.UUID, allowNull: true, defaultValue: null },
    category: { type: Sequelize.STRING(30), allowNull: false },
    amount: { type: Sequelize.DECIMAL(14, 2), defaultValue: 0 },
    year: { type: Sequelize.STRING(10) },
    date: { type: Sequelize.DATEONLY, defaultValue: Sequelize.NOW },
    notes: { type: Sequelize.STRING(500), defaultValue: "" },
    crop_sale: { type: Sequelize.JSONB, defaultValue: null },
    subsidy: { type: Sequelize.JSONB, defaultValue: null },
    rental_income: { type: Sequelize.JSONB, defaultValue: null },
    other_income: { type: Sequelize.JSONB, defaultValue: null },
  },
  { tableName: "incomes" }
);

function computeIncomeAmount(income) {
  const cs = income.crop_sale;
  const sb = income.subsidy;
  const ri = income.rental_income;
  const oi = income.other_income;
  switch (income.category) {
    case "Crop Sale":
      if (cs) {
        const qty = cs.quantitySold ?? cs.quantityKg ?? 0;
        const price = cs.pricePerUnit ?? cs.pricePerKg ?? 0;
        income.amount = +(qty * price).toFixed(2);
      }
      break;
    case "Subsidy":
      income.amount = sb?.amount ?? 0;
      break;
    case "Rental Income":
      if (ri) income.amount = +(ri.hoursOrDays * ri.ratePerUnit).toFixed(2);
      break;
    case "Other":
      income.amount = oi?.amount ?? 0;
      break;
    default:
      income.amount = 0;
  }
  // Keep fiscal year aligned with crops (financialYear like "2025-26").
  // If route/DB hasn't set `year`, derive from the entry date.
  const computedFY = getFinancialYearFromDate(new Date(income.date || new Date()));
  if (!income.year || typeof income.year !== "string" || !String(income.year).includes("-")) {
    income.year = computedFY;
  }
}

Income.beforeCreate(computeIncomeAmount);
Income.beforeUpdate(computeIncomeAmount);

User.hasMany(Income, { foreignKey: "user_id" });
Income.belongsTo(User, { foreignKey: "user_id" });
Crop.hasMany(Income, { foreignKey: "crop_id", constraints: false });
Income.belongsTo(Crop, { foreignKey: "crop_id", constraints: false });

// ─── Expense ───────────────────────────────────────────────────────────────────
const Expense = sequelize.define(
  "Expense",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    /** Null for general expense (સામાન્ય ખર્ચ) not linked to any crop */
    crop_id: { type: Sequelize.UUID, allowNull: true, references: { model: "crops", key: "id" } },
    category: { type: Sequelize.STRING(30), allowNull: false },
    expense_source: { type: Sequelize.STRING(30), allowNull: true, defaultValue: null },
    amount: { type: Sequelize.DECIMAL(14, 2), defaultValue: 0 },
    year: { type: Sequelize.STRING(10) },
    date: { type: Sequelize.DATEONLY, defaultValue: Sequelize.NOW },
    notes: { type: Sequelize.STRING(500), defaultValue: "" },
    seed: { type: Sequelize.JSONB, defaultValue: null },
    fertilizer: { type: Sequelize.JSONB, defaultValue: null },
    pesticide: { type: Sequelize.JSONB, defaultValue: null },
    labour_daily: { type: Sequelize.JSONB, defaultValue: null },
    labour_contract: { type: Sequelize.JSONB, defaultValue: null },
    machinery: { type: Sequelize.JSONB, defaultValue: null },
    irrigation: { type: Sequelize.JSONB, defaultValue: null },
    other: { type: Sequelize.JSONB, defaultValue: null },
  },
  { tableName: "expenses" }
);

function computeExpenseAmount(expense) {
  const ld = expense.labour_daily;
  if (ld && ld.numberOfPeople && ld.days && ld.dailyRate) {
    ld.totalCost = ld.numberOfPeople * ld.days * ld.dailyRate;
  }
  const lc = expense.labour_contract;
  if (lc && lc.advanceExpenses) {
    const ae = lc.advanceExpenses;
    const advanceTotal = (ae.cash || 0) + (ae.grocery || 0) + (ae.medical || 0) + (ae.mobileRecharge || 0);
    if (advanceTotal > 0) lc.amountGiven = advanceTotal;
  }
  const m = expense.machinery;
  if (m && m.hoursOrAcres != null && m.rate != null) {
    m.totalCost = +(m.hoursOrAcres * m.rate).toFixed(2);
  }
  switch (expense.category) {
    case "Seed":
      expense.amount = expense.seed?.totalCost ?? 0;
      break;
    case "Fertilizer":
      expense.amount = expense.fertilizer?.totalCost ?? 0;
      break;
    case "Pesticide":
      expense.amount = expense.pesticide?.cost ?? 0;
      break;
    case "Labour":
      expense.amount = (ld?.totalCost ?? 0) + (lc?.amountGiven ?? 0);
      break;
    case "Machinery":
      expense.amount = m?.totalCost ?? (m ? +(m.hoursOrAcres * m.rate).toFixed(2) : 0);
      break;
    case "Irrigation":
      expense.amount = expense.irrigation?.amount ?? 0;
      break;
    case "Other":
      expense.amount = expense.other?.totalAmount ?? 0;
      break;
    default:
      expense.amount = 0;
  }
  // Keep fiscal year aligned with crops (financialYear like "2025-26").
  // If route/DB hasn't set `year`, derive from the entry date.
  const computedFY = getFinancialYearFromDate(new Date(expense.date || new Date()));
  if (!expense.year || typeof expense.year !== "string" || !String(expense.year).includes("-")) {
    expense.year = computedFY;
  }
}

Expense.beforeCreate(computeExpenseAmount);
Expense.beforeUpdate(computeExpenseAmount);

User.hasMany(Expense, { foreignKey: "user_id" });
Expense.belongsTo(User, { foreignKey: "user_id" });
Crop.hasMany(Expense, { foreignKey: "crop_id", constraints: false });
Expense.belongsTo(Crop, { foreignKey: "crop_id", constraints: false });

// ─── ServiceLedger ─────────────────────────────────────────────────────────────
const ServiceLedger = sequelize.define(
  "ServiceLedger",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    provider_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    customer_farmer_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    service_type: { type: Sequelize.STRING(30), allowNull: false },
    area_bigha: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    rate_per_bigha: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
    total_amount: { type: Sequelize.DECIMAL(14, 2), defaultValue: 0 },
    payment_status: { type: Sequelize.STRING(20), defaultValue: "Pending" },
    date: { type: Sequelize.DATEONLY, defaultValue: Sequelize.NOW },
    notes: { type: Sequelize.STRING(500), defaultValue: "" },
    linked_expense_id: { type: Sequelize.UUID, allowNull: true, defaultValue: null },
  },
  { tableName: "service_ledgers" }
);

User.hasMany(ServiceLedger, { foreignKey: "provider_id" });
User.hasMany(ServiceLedger, { foreignKey: "customer_farmer_id" });
ServiceLedger.belongsTo(User, { as: "Provider", foreignKey: "provider_id" });
ServiceLedger.belongsTo(User, { as: "Customer", foreignKey: "customer_farmer_id" });

// ─── Notification ───────────────────────────────────────────────────────────────
const Notification = sequelize.define(
  "Notification",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    type: { type: Sequelize.STRING(50), allowNull: false, defaultValue: "General" },
    title: { type: Sequelize.STRING(160), allowNull: false },
    message: { type: Sequelize.STRING(500), allowNull: false },
    reference_type: { type: Sequelize.STRING(40), allowNull: true, defaultValue: null },
    reference_id: { type: Sequelize.UUID, allowNull: true, defaultValue: null },
    meta: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
    is_read: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
    read_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
  },
  { tableName: "notifications" }
);

User.hasMany(Notification, { foreignKey: "user_id" });
Notification.belongsTo(User, { foreignKey: "user_id" });

// ─── PushToken ────────────────────────────────────────────────────────────────
const PushToken = sequelize.define(
  "PushToken",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    user_id: { type: Sequelize.UUID, allowNull: false, references: { model: "users", key: "id" } },
    token: { type: Sequelize.STRING(255), allowNull: false },
    platform: { type: Sequelize.STRING(20), allowNull: false, defaultValue: "unknown" },
    is_active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    last_seen_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
  },
  {
    tableName: "push_tokens",
    indexes: [{ unique: true, fields: ["user_id", "token"] }],
  }
);

User.hasMany(PushToken, { foreignKey: "user_id" });
PushToken.belongsTo(User, { foreignKey: "user_id" });

// ─── Map Sequelize row to API shape (camelCase + _id) ─────────────────────────
function mapRow(row) {
  if (!row) return null;
  const plain = row.get ? row.get({ plain: true }) : row;
  const out = {};
  for (const [k, v] of Object.entries(plain)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  out._id = out.id;
  if (out.totalLandValue !== undefined) {
    out.totalLand = { value: parseFloat(out.totalLandValue), unit: out.totalLandUnit || "bigha" };
    delete out.totalLandValue;
    delete out.totalLandUnit;
  }
  return out;
}

function mapCrop(row) {
  const o = mapRow(row);
  if (!o) return o;
  o.cropName = o.cropName ?? row.crop_name;
  o.areaUnit = o.areaUnit ?? row.area_unit;
  o.cropEmoji = o.cropEmoji ?? row.crop_emoji;
  o.subType = o.subType ?? row.sub_type;
  o.batchLabel = o.batchLabel ?? row.batch_label;
  o.farmName = o.farmName ?? row.farm_name;
  o.landType = o.landType ?? row.land_type;
  o.bhagmaPercentage = o.bhagmaPercentage ?? row.bhagma_percentage;
  o.sowingDate = o.sowingDate ?? row.sowing_date;
  o.harvestDate = o.harvestDate ?? row.harvest_date;
  o.userId = o.userId ?? row.user_id;
  return o;
}

function mapIncome(row) {
  const o = mapRow(row);
  if (!o) return o;
  o.cropSale = o.cropSale ?? row.crop_sale;
  o.subsidy = o.subsidy ?? row.subsidy;
  o.rentalIncome = o.rentalIncome ?? row.rental_income;
  o.otherIncome = o.otherIncome ?? row.other_income;
  o.userId = o.userId ?? row.user_id;
  o.cropId = o.cropId ?? row.crop_id;
  return o;
}

function mapExpense(row) {
  const o = mapRow(row);
  if (!o) return o;
  o.seed = o.seed ?? row.seed;
  o.fertilizer = o.fertilizer ?? row.fertilizer;
  o.pesticide = o.pesticide ?? row.pesticide;
  o.labourDaily = o.labourDaily ?? row.labour_daily;
  o.labourContract = o.labourContract ?? row.labour_contract;
  o.machinery = o.machinery ?? row.machinery;
  o.irrigation = o.irrigation ?? row.irrigation;
  o.other = o.other ?? row.other;
  o.userId = o.userId ?? row.user_id;
  o.cropId = o.cropId ?? row.crop_id;
  o.expenseSource = o.expenseSource ?? row.expense_source;
  return o;
}

function mapNotification(row) {
  const o = mapRow(row);
  if (!o) return o;
  o.userId = o.userId ?? row.user_id;
  o.referenceType = o.referenceType ?? row.reference_type;
  o.referenceId = o.referenceId ?? row.reference_id;
  o.isRead = o.isRead ?? row.is_read;
  o.readAt = o.readAt ?? row.read_at;
  return o;
}

ServiceLedger.beforeCreate((ledger) => {
  if (ledger.area_bigha != null && ledger.rate_per_bigha != null)
    ledger.total_amount = +(parseFloat(ledger.area_bigha) * parseFloat(ledger.rate_per_bigha)).toFixed(2);
});
ServiceLedger.beforeUpdate((ledger) => {
  if (ledger.area_bigha != null && ledger.rate_per_bigha != null)
    ledger.total_amount = +(parseFloat(ledger.area_bigha) * parseFloat(ledger.rate_per_bigha)).toFixed(2);
});

// ─── Location (Gujarat districts/talukas/villages — reference data) ─────────
const Location = sequelize.define(
  "Location",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    type: { type: Sequelize.STRING(20), allowNull: false }, // 'district' | 'taluka' | 'village'
    value: { type: Sequelize.STRING(100), allowNull: false },
    label: { type: Sequelize.STRING(100), allowNull: false },
    district_value: { type: Sequelize.STRING(100), allowNull: true },
    taluka_value: { type: Sequelize.STRING(100), allowNull: true },
  },
  { tableName: "locations", timestamps: false }
);

// ─── APMC Daily Price Snapshot ────────────────────────────────────────────────
const ApmcDailyPrice = sequelize.define(
  "ApmcDailyPrice",
  {
    id: {
      type: Sequelize.UUID,
      defaultValue: Sequelize.UUIDV4,
      primaryKey: true,
    },
    snapshot_date: { type: Sequelize.DATEONLY, allowNull: false },
    arrival_date: { type: Sequelize.STRING(20), allowNull: true, defaultValue: null },
    state: { type: Sequelize.STRING(80), allowNull: false, defaultValue: "Gujarat" },
    district: { type: Sequelize.STRING(120), allowNull: false },
    market: { type: Sequelize.STRING(160), allowNull: false },
    commodity: { type: Sequelize.STRING(120), allowNull: false },
    variety: { type: Sequelize.STRING(120), allowNull: true, defaultValue: null },
    min_price: { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
    max_price: { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
    modal_price: { type: Sequelize.DECIMAL(12, 2), allowNull: true, defaultValue: null },
    raw_record: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
  },
  {
    tableName: "apmc_daily_prices",
    indexes: [
      { name: "idx_apmc_snapshot_date", fields: ["snapshot_date"] },
      { name: "idx_apmc_state_district", fields: ["state", "district"] },
      { name: "idx_apmc_commodity", fields: ["commodity"] },
      {
        name: "uq_apmc_day_state_dist_mkt_cmd_var",
        unique: true,
        fields: ["snapshot_date", "state", "district", "market", "commodity", "variety"],
      },
    ],
  }
);

module.exports = {
  sequelize,
  Sequelize,
  User,
  FarmerProfile,
  Crop,
  Income,
  Expense,
  ServiceLedger,
  Notification,
  PushToken,
  Location,
  ApmcDailyPrice,
  toApiShape,
  mapRow,
  mapCrop,
  mapIncome,
  mapExpense,
  mapNotification,
};
