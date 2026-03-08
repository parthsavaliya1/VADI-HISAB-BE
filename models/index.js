const { sequelize, Sequelize } = require("../config/database");

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
    year: { type: Sequelize.INTEGER },
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
  income.year = new Date(income.date || new Date()).getFullYear();
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
    amount: { type: Sequelize.DECIMAL(14, 2), defaultValue: 0 },
    year: { type: Sequelize.INTEGER },
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
  expense.year = new Date(expense.date || new Date()).getFullYear();
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

module.exports = {
  sequelize,
  Sequelize,
  User,
  FarmerProfile,
  Crop,
  Income,
  Expense,
  ServiceLedger,
  toApiShape,
  mapRow,
  mapCrop,
  mapIncome,
  mapExpense,
};
