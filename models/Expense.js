const mongoose = require("mongoose");

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const SeedExpenseSchema = new mongoose.Schema({
  seedType: {
    type: String,
    enum: ["Company Brand", "Local/Desi", "Hybrid"],
    required: true,
  },
  quantityKg: { type: Number, required: true, min: 0 },
  totalCost: { type: Number, required: true, min: 1 },
  // derived: totalCost / quantityKg
  ratePerKg: { type: Number },
});

const FertilizerExpenseSchema = new mongoose.Schema({
  productName: {
    type: String,
    enum: ["Urea", "DAP", "NPK", "Organic", "Sulphur", "Micronutrients"],
    required: true,
  },
  numberOfBags: { type: Number, required: true, min: 0 },
  totalCost: { type: Number, required: true, min: 1 },
});

const PesticideExpenseSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ["Insecticide", "Fungicide", "Herbicide", "Growth Booster"],
    required: true,
  },
  dosageML: { type: Number, required: true, min: 0 },
  cost: { type: Number, required: true, min: 1 },
});

const LabourDailySchema = new mongoose.Schema({
  task: {
    type: String,
    enum: ["Weeding", "Sowing", "Spraying", "Harvesting", "Irrigation"],
    required: true,
  },
  numberOfPeople: { type: Number, required: true, min: 1 },
  days: { type: Number, required: true, min: 1 },
  dailyRate: { type: Number, required: true, min: 1 },
  // derived: numberOfPeople * days * dailyRate
  totalCost: { type: Number },
});

const LabourContractSchema = new mongoose.Schema({
  advanceReason: {
    type: String,
    enum: [
      "Medical",
      "Grocery",
      "Mobile Recharge",
      "Festival",
      "Loan",
      "Other",
    ],
    required: true,
  },
  amountGiven: { type: Number, required: true, min: 1 },
});

const MachineryExpenseSchema = new mongoose.Schema({
  implement: {
    type: String,
    enum: [
      "Rotavator",
      "Plough",
      "Sowing Machine",
      "Thresher",
      "Tractor Rental",
      "બલૂન (Baluun)",
      "રેપ (Rap)",
    ],
    required: true,
  },
  isContract: { type: Boolean, default: false },
  hoursOrAcres: { type: Number, required: true, min: 0 },
  rate: { type: Number, required: true, min: 1 },
  // derived: hoursOrAcres * rate
  totalCost: { type: Number },
});

// ─── Main Expense Schema ──────────────────────────────────────────────────────

const ExpenseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // set true when auth is live
    },
    cropId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Crop",
      required: true,
    },
    category: {
      type: String,
      enum: ["Seed", "Fertilizer", "Pesticide", "Labour", "Machinery"],
      required: true,
    },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: "" },

    // Only one of these will be populated based on category
    seed: SeedExpenseSchema,
    fertilizer: FertilizerExpenseSchema,
    pesticide: PesticideExpenseSchema,
    labourDaily: LabourDailySchema,
    labourContract: LabourContractSchema,
    machinery: MachineryExpenseSchema,
  },
  { timestamps: true },
);

// ─── Pre-save: compute derived fields ────────────────────────────────────────

ExpenseSchema.pre("save", function (next) {
  if (this.seed && this.seed.quantityKg > 0) {
    this.seed.ratePerKg = +(this.seed.totalCost / this.seed.quantityKg).toFixed(
      2,
    );
  }
  if (this.labourDaily) {
    this.labourDaily.totalCost =
      this.labourDaily.numberOfPeople *
      this.labourDaily.days *
      this.labourDaily.dailyRate;
  }
  if (this.machinery) {
    this.machinery.totalCost = +(
      this.machinery.hoursOrAcres * this.machinery.rate
    ).toFixed(2);
  }
  next();
});

module.exports = mongoose.model("Expense", ExpenseSchema);
