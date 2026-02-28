const mongoose = require("mongoose");

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

const CropSaleSchema = new mongoose.Schema({
  cropName: { type: String, required: true, trim: true },
  quantityKg: { type: Number, required: true, min: 0 },
  pricePerKg: { type: Number, required: true, min: 0 },
  // derived: quantityKg * pricePerKg
  totalAmount: { type: Number },
  buyerName: { type: String, default: "" },
  marketName: { type: String, default: "" },
});

const SubsidySchema = new mongoose.Schema({
  schemeType: {
    type: String,
    enum: [
      "PM-KISAN",
      "Fasal Bima (Crop Insurance)",
      "Seed Subsidy",
      "Fertilizer Subsidy",
      "Irrigation Subsidy",
      "Equipment Subsidy",
      "Other Government Scheme",
    ],
    required: true,
  },
  amount: { type: Number, required: true, min: 1 },
  referenceNumber: { type: String, default: "" },
});

const RentalIncomeSchema = new mongoose.Schema({
  assetType: {
    type: String,
    enum: [
      "Tractor",
      "Rotavator",
      "Thresher",
      "Land",
      "Water Pump",
      "Other Equipment",
    ],
    required: true,
  },
  rentedToName: { type: String, default: "" },
  hoursOrDays: { type: Number, required: true, min: 0 },
  ratePerUnit: { type: Number, required: true, min: 1 },
  // derived: hoursOrDays * ratePerUnit
  totalAmount: { type: Number },
});

const OtherIncomeSchema = new mongoose.Schema({
  source: {
    type: String,
    enum: [
      "Labour Work",
      "Animal Husbandry",
      "Dairy",
      "Part-time Work",
      "Loan Received",
      "Other",
    ],
    required: true,
  },
  amount: { type: Number, required: true, min: 1 },
  description: { type: String, default: "" },
});

// ─── Main Income Schema ───────────────────────────────────────────────────────

const IncomeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // set true when auth is live
    },
    cropId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Crop",
      required: false, // not all income is crop-linked (e.g. subsidy, rental)
    },
    category: {
      type: String,
      enum: ["Crop Sale", "Subsidy", "Rental Income", "Other"],
      required: true,
    },
    date: { type: Date, default: Date.now },
    notes: { type: String, default: "" },

    // Only one of these will be populated based on category
    cropSale: CropSaleSchema,
    subsidy: SubsidySchema,
    rentalIncome: RentalIncomeSchema,
    otherIncome: OtherIncomeSchema,
  },
  { timestamps: true },
);

// ─── Pre-save: compute derived fields ────────────────────────────────────────

IncomeSchema.pre("save", function () {
  if (this.cropSale) {
    this.cropSale.totalAmount = +(
      this.cropSale.quantityKg * this.cropSale.pricePerKg
    ).toFixed(2);
  }

  if (this.rentalIncome) {
    this.rentalIncome.totalAmount = +(
      this.rentalIncome.hoursOrDays * this.rentalIncome.ratePerUnit
    ).toFixed(2);
  }
});

// ─── Index for year-based filtering ──────────────────────────────────────────
// Usage: Income.find({ date: { $gte: new Date('2024-01-01'), $lt: new Date('2025-01-01') } })
IncomeSchema.index({ date: 1 });
IncomeSchema.index({ userId: 1, date: 1 });
IncomeSchema.index({ cropId: 1, date: 1 });

module.exports = mongoose.model("Income", IncomeSchema);
