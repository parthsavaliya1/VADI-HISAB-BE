/**
 * Seed script: creates a few demo farmers with crops, incomes and expenses
 * so that the Report tab and comparison features show realistic data.
 *
 * Run from VADI-HISAB-BE folder:
 *   node scripts/seed-demo-data.js
 *
 * Requires DATABASE_URL / PG_URI to be configured (same as the backend).
 */
require("dotenv").config();
const { sequelize, User, FarmerProfile, Crop, Income, Expense } = require("../models");

async function createFarmer({ phone, name, district, taluka, village, totalLand, farms, dataSharing }) {
  const [user] = await User.findOrCreate({
    where: { phone },
    defaults: {
      role: "farmer",
      is_profile_completed: true,
    },
  });

  const [profile] = await FarmerProfile.findOrCreate({
    where: { user_id: user.id },
    defaults: {
      name,
      district,
      taluka,
      village,
      total_land_value: totalLand,
      total_land_unit: "bigha",
      water_sources: ["Borewell"],
      tractor_available: true,
      implements_available: ["Rotavator", "RAP"],
      labour_types: ["Mixed"],
      farms,
      data_sharing: dataSharing,
    },
  });

  return { user, profile };
}

function getCropEmojiForName(cropName) {
  switch (cropName) {
    case "Cotton":
      return "💮";
    case "Groundnut":
      return "🥜";
    case "Jeera":
      return "🌿";
    case "Garlic":
      return "🧄";
    case "Onion":
      return "🧅";
    case "Chana":
      return "🫘";
    case "Wheat":
      return "🌾";
    case "Bajra":
      return "🌾";
    case "Maize":
      return "🌽";
    default:
      return "🌱";
  }
}

async function createCropWithTransactions({ user, year, season, cropName, area, incomePerBigha }) {
  const crop = await Crop.create({
    user_id: user.id,
    season,
    year,
    crop_name: cropName,
    crop_emoji: getCropEmojiForName(cropName),
    sub_type: "",
    batch_label: "",
    farm_name: "વાડી",
    area,
    area_unit: "Bigha",
    land_type: "ghare",
    bhagma_percentage: null,
    sowing_date: `${year.split("-")[0]}-07-01`,
    harvest_date: `${year.split("-")[0]}-12-15`,
    status: "Completed",
    notes: "",
  });

  const totalIncome = incomePerBigha * area;
  const totalExpense = totalIncome * 0.6; // ~60% expense ratio

  // Split expense roughly across all categories so every chart has data
  const seedCost = +(totalExpense * 0.18).toFixed(2);
  const fertCost = +(totalExpense * 0.18).toFixed(2);
  const pestCost = +(totalExpense * 0.14).toFixed(2);
  const labourCost = +(totalExpense * 0.20).toFixed(2);
  const machineryCost = +(totalExpense * 0.15).toFixed(2);
  const irrigationCost = +(totalExpense * 0.10).toFixed(2);
  const otherCost = +(totalExpense * 0.05).toFixed(2);

  // Income from crop sale
  await Income.create({
    user_id: user.id,
    crop_id: crop.id,
    category: "Crop Sale",
    date: `${year.split("-")[0]}-12-20`,
    crop_sale: {
      cropName,
      quantityKg: 1000,
      pricePerKg: +(totalIncome / 1000).toFixed(2),
      marketName: "APMC બજાર",
    },
  });

  // Expense lines for all categories (Seed, Fertilizer, Pesticide, Labour, Machinery, Irrigation, Other)
  await Expense.bulkCreate([
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Seed",
      date: `${year.split("-")[0]}-06-15`,
      seed: {
        seedType: "Hybrid",
        quantityKg: 40,
        totalCost: seedCost,
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Fertilizer",
      date: `${year.split("-")[0]}-08-10`,
      fertilizer: {
        productName: "DAP",
        numberOfBags: 10,
        totalCost: fertCost,
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Pesticide",
      date: `${year.split("-")[0]}-09-05`,
      pesticide: {
        category: "Insecticide",
        dosageML: 1500,
        cost: pestCost,
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Labour",
      date: `${year.split("-")[0]}-11-01`,
      labour_daily: {
        task: "Harvesting",
        numberOfPeople: 6,
        days: 4,
        dailyRate: +(labourCost / (6 * 4)).toFixed(0),
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Machinery",
      date: `${year.split("-")[0]}-10-10`,
      machinery: {
        implement: "Tractor Rental",
        isContract: false,
        hoursOrAcres: 12,
        rate: +(machineryCost / 12).toFixed(0),
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Irrigation",
      date: `${year.split("-")[0]}-08-25`,
      irrigation: {
        amount: irrigationCost,
      },
    },
    {
      user_id: user.id,
      crop_id: crop.id,
      category: "Other",
      date: `${year.split("-")[0]}-07-20`,
      other: {
        totalAmount: otherCost,
        description: "અન્ય ખેતી સંબંધિત ખર્ચ",
      },
    },
  ]);
}

async function seed() {
  try {
    await sequelize.authenticate();
    console.log("DB connected");

    const year = "2025-26";

    // Create 3 demo farmers with data sharing ON
    const farmers = await Promise.all([
      createFarmer({
        phone: "9100000001",
        name: "રમેશભાઈ પટેલ",
        district: "Ahmedabad",
        taluka: "Dholka",
        village: "Navagam",
        totalLand: 15,
        farms: [{ name: "વાડી", area: 10 }, { name: "ખેતર", area: 5 }],
        dataSharing: true,
      }),
      createFarmer({
        phone: "9100000002",
        name: "સુરેશભાઈ દેસાઈ",
        district: "Surat",
        taluka: "Kamrej",
        village: "Amroli",
        totalLand: 20,
        farms: [{ name: "મોટી વાડી", area: 20 }],
        dataSharing: true,
      }),
      createFarmer({
        phone: "9100000003",
        name: "જીતુભાઈ ચૌધરી",
        district: "Banaskantha",
        taluka: "Dhanera",
        village: "Ranpur",
        totalLand: 8,
        farms: [{ name: "ડુંગર", area: 8 }],
        dataSharing: true,
      }),
    ]);

    // Create crops + income/expense for each farmer
    await createCropWithTransactions({
      user: farmers[0].user,
      year,
      season: "Kharif",
      cropName: "Cotton",
      area: 8,
      incomePerBigha: 35000,
    });
    await createCropWithTransactions({
      user: farmers[0].user,
      year,
      season: "Rabi",
      cropName: "Wheat",
      area: 5,
      incomePerBigha: 28000,
    });

    await createCropWithTransactions({
      user: farmers[1].user,
      year,
      season: "Kharif",
      cropName: "Groundnut",
      area: 12,
      incomePerBigha: 30000,
    });

    await createCropWithTransactions({
      user: farmers[2].user,
      year,
      season: "Kharif",
      cropName: "Maize",
      area: 6,
      incomePerBigha: 22000,
    });

    console.log("Demo farmers, crops, incomes and expenses seeded successfully.");
    process.exit(0);
  } catch (err) {
    console.error("Demo seed failed:", err);
    process.exit(1);
  }
}

seed();

