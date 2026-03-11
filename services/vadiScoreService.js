const { Op, fn, col, literal } = require("sequelize");
const { sequelize, User, FarmerProfile, Crop, Income, Expense } = require("../models");

function parseYearStart(fy) {
  // "2025-26" → 2025
  if (!fy) return null;
  const y = parseInt(String(fy).split("-")[0], 10);
  return Number.isFinite(y) ? y : null;
}

function areaToBigha(area, unit) {
  const a = parseFloat(area) || 0;
  if (!a) return 0;
  if (!unit || unit.toLowerCase() === "bigha") return a;
  if (unit.toLowerCase() === "acre") return a * 1.6;
  if (unit.toLowerCase() === "hectare") return a * 6.17;
  return a;
}

function classifyScore(score) {
  if (score >= 90) return "Excellent farmer";
  if (score >= 80) return "Above average";
  if (score >= 70) return "Good";
  if (score >= 60) return "Average";
  return "Needs improvement";
}

async function computeVadiScoreForUser(userId) {
  const profile = await FarmerProfile.findOne({ where: { user_id: userId } });
  if (!profile) {
    return {
      farmer_vadi_score: null,
      crop_vadi_scores: [],
      production_index: null,
      expense_index: null,
      profit_index: null,
      village_rank: null,
      village_total_farmers: 0,
      farmer_insights: [],
      potential_income_improvement: 0,
      classification: null,
    };
  }

  const villageKey = `${profile.district}|${profile.taluka}|${profile.village}`;

  const crops = await Crop.findAll({
    where: { user_id: userId },
    raw: true,
  });
  if (!crops.length) {
    return {
      farmer_vadi_score: null,
      crop_vadi_scores: [],
      production_index: null,
      expense_index: null,
      profit_index: null,
      village_rank: null,
      village_total_farmers: 0,
      farmer_insights: [],
      potential_income_improvement: 0,
      classification: null,
    };
  }

  const cropIds = crops.map((c) => c.id);
  const [incomeRows, expenseRows] = await Promise.all([
    Income.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    }),
    Expense.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    }),
  ]);
  const incomeByCrop = Object.fromEntries(
    incomeRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );
  const expenseByCrop = Object.fromEntries(
    expenseRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );

  const cropMetrics = [];
  for (const crop of crops) {
    const areaBigha = areaToBigha(crop.area, crop.area_unit);
    if (!areaBigha || areaBigha <= 0) continue;

    // For now, approximate production using total income (we don't yet store yield directly everywhere)
    const totalIncome = incomeByCrop[crop.id] || 0;
    const totalExpense = expenseByCrop[crop.id] || 0;
    const profit = totalIncome - totalExpense;

    const productionPerBigha = totalIncome > 0 ? totalIncome / areaBigha : 0; // placeholder until yield field is standardised
    const expensePerBigha = totalExpense / areaBigha;
    const profitPerBigha = profit / areaBigha;

    if (areaBigha <= 0 || productionPerBigha <= 0) continue;

    cropMetrics.push({
      crop,
      areaBigha,
      totalIncome,
      totalExpense,
      profit,
      productionPerBigha,
      expensePerBigha,
      profitPerBigha,
      season: crop.season,
      year: crop.year,
    });
  }

  if (!cropMetrics.length) {
    return {
      farmer_vadi_score: null,
      crop_vadi_scores: [],
      production_index: null,
      expense_index: null,
      profit_index: null,
      village_rank: null,
      village_total_farmers: 0,
      farmer_insights: [],
      potential_income_improvement: 0,
      classification: null,
    };
  }

  // ── Village rolling averages (3 seasons) ───────────────────────────────────
  // Group key: district|taluka|village|crop_name|season
  const seasons = Array.from(
    new Set(cropMetrics.map((m) => String(m.year)))
  ).sort((a, b) => (parseYearStart(a) || 0) - (parseYearStart(b) || 0));
  const last3 = seasons.slice(-3);

  const cropByKey = {};
  cropMetrics.forEach((m) => {
    const key = `${villageKey}|${m.crop.crop_name}|${m.season}`;
    if (!cropByKey[key]) cropByKey[key] = [];
    cropByKey[key].push(m);
  });

  // For village averages we need data from all farmers in same village
  const villageProfiles = await FarmerProfile.findAll({
    where: {
      district: profile.district,
      taluka: profile.taluka,
      village: profile.village,
    },
    attributes: ["user_id"],
    raw: true,
  });
  const villageUserIds = villageProfiles.map((p) => p.user_id);

  const allVillageCrops = await Crop.findAll({
    where: {
      user_id: { [Op.in]: villageUserIds },
      year: { [Op.in]: last3 },
    },
    raw: true,
  });
  const allVillageCropIds = allVillageCrops.map((c) => c.id);
  const [allVillageIncomeRows, allVillageExpenseRows] = await Promise.all([
    Income.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: allVillageCropIds } },
      group: ["crop_id"],
      raw: true,
    }),
    Expense.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: allVillageCropIds } },
      group: ["crop_id"],
      raw: true,
    }),
  ]);
  const allIncomeByCrop = Object.fromEntries(
    allVillageIncomeRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );
  const allExpenseByCrop = Object.fromEntries(
    allVillageExpenseRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );

  // Build per (user, key) metrics for rolling averages
  const perUserKey = {};
  for (const c of allVillageCrops) {
    const fy = String(c.year);
    if (!last3.includes(fy)) continue;
    const k = `${villageKey}|${c.crop_name}|${c.season}`;
    const ukey = `${c.user_id}|${k}`;
    const areaB = areaToBigha(c.area, c.area_unit);
    if (!areaB || areaB <= 0) continue;
    const inc = allIncomeByCrop[c.id] || 0;
    const exp = allExpenseByCrop[c.id] || 0;
    const prof = inc - exp;
    const prodPB = inc > 0 ? inc / areaB : 0; // placeholder
    if (prodPB <= 0) continue;
    if (!perUserKey[ukey]) {
      perUserKey[ukey] = { area: 0, prodPB: 0, expPB: 0, profPB: 0, crops: 0 };
    }
    const rec = perUserKey[ukey];
    rec.area += areaB;
    rec.prodPB += prodPB;
    rec.expPB += exp / areaB;
    rec.profPB += prof / areaB;
    rec.crops += 1;
  }

  const villageAverages = {};
  Object.entries(perUserKey).forEach(([ukey, v]) => {
    const [, key] = ukey.split("|", 2);
    const avgProd = v.prodPB / v.crops;
    const avgExp = v.expPB / v.crops;
    const avgProf = v.profPB / v.crops;
    if (!villageAverages[key]) {
      villageAverages[key] = {
        farmers: 0,
        totalArea: 0,
        prodList: [],
        expList: [],
        profList: [],
      };
    }
    const agg = villageAverages[key];
    agg.farmers += 1;
    agg.totalArea += v.area;
    agg.prodList.push(avgProd);
    agg.expList.push(avgExp);
    agg.profList.push(avgProf);
  });

  const averagedByKey = {};
  Object.entries(villageAverages).forEach(([key, v]) => {
    if (v.farmers < 10 && v.totalArea < 20) {
      averagedByKey[key] = null; // insufficient
    } else {
      const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
      averagedByKey[key] = {
        prodPB: avg(v.prodList),
        expPB: avg(v.expList),
        profPB: avg(v.profList),
      };
    }
  });

  // ── Compute per-crop indexes and scores ────────────────────────────────────
  const cropScores = [];
  let totalAreaForScore = 0;
  let sumProdIdx = 0;
  let sumExpIdx = 0;
  let sumProfIdx = 0;

  const insights = [];
  let potentialIncomeImprovement = 0;

  for (const m of cropMetrics) {
    const key = `${villageKey}|${m.crop.crop_name}|${m.season}`;
    const villageAvg = averagedByKey[key];
    if (!villageAvg || villageAvg.prodPB <= 0 || m.productionPerBigha <= 0) {
      cropScores.push({
        crop_id: m.crop.id,
        crop_name: m.crop.crop_name,
        season: m.season,
        area_bigha: m.areaBigha,
        insufficient_data_for_comparison: true,
      });
      continue;
    }

    let productionIndex = (m.productionPerBigha / villageAvg.prodPB) * 100;
    let expenseIndex =
      m.expensePerBigha > 0 ? (villageAvg.expPB / m.expensePerBigha) * 100 : 0;
    let profitIndex =
      villageAvg.profPB > 0
        ? (m.profitPerBigha / villageAvg.profPB) * 100
        : 0;

    const isOutlier =
      m.productionPerBigha > 3 * villageAvg.prodPB ? true : false;

    const clamp = (v) => Math.max(0, Math.min(150, v || 0));
    productionIndex = clamp(productionIndex);
    expenseIndex = clamp(expenseIndex);
    profitIndex = clamp(profitIndex);

    const rawScore =
      0.5 * productionIndex +
      0.35 * expenseIndex +
      0.15 * profitIndex;
    const cropVadiScore = Math.min(100, (rawScore / 150) * 100);

    cropScores.push({
      crop_id: m.crop.id,
      crop_name: m.crop.crop_name,
      season: m.season,
      area_bigha: m.areaBigha,
      production_index: productionIndex,
      expense_index: expenseIndex,
      profit_index: profitIndex,
      crop_vadi_score: Math.round(cropVadiScore),
      outlier: isOutlier,
    });

    totalAreaForScore += m.areaBigha;
    sumProdIdx += productionIndex * m.areaBigha;
    sumExpIdx += expenseIndex * m.areaBigha;
    sumProfIdx += profitIndex * m.areaBigha;

    // Simple insights for this crop
    const fertDiffPct =
      m.expensePerBigha && villageAvg.expPB
        ? ((m.expensePerBigha - villageAvg.expPB) / villageAvg.expPB) * 100
        : 0;
    if (fertDiffPct > 10) {
      insights.push(
        `તમારો ખર્ચ પ્રતિ વીઘા ગામની સરેરાશ કરતાં અંદાજે ${Math.round(
          fertDiffPct
        )}% વધારે છે.`
      );
    }
    if (m.productionPerBigha < villageAvg.prodPB) {
      insights.push(
        `તમારી ઉત્પાદન પ્રતિ વીઘા ગામની સરેરાશ કરતાં ઓછું છે. સિંચાઈ કે બીજની ગુણવત્તા સુધારવાથી ઉત્પાદન વધી શકે છે.`
      );
    }

    // Potential improvement estimate (rough)
    const lowerExpense =
      m.expensePerBigha > villageAvg.expPB
        ? m.expensePerBigha - villageAvg.expPB
        : 0;
    potentialIncomeImprovement += lowerExpense * m.areaBigha;
  }

  if (!cropScores.length || !totalAreaForScore) {
    return {
      farmer_vadi_score: null,
      crop_vadi_scores: cropScores,
      production_index: null,
      expense_index: null,
      profit_index: null,
      village_rank: null,
      village_total_farmers: villageUserIds.length,
      farmer_insights: insights,
      potential_income_improvement: Math.round(potentialIncomeImprovement),
      classification: null,
    };
  }

  const farmerProdIdx = sumProdIdx / totalAreaForScore;
  const farmerExpIdx = sumExpIdx / totalAreaForScore;
  const farmerProfIdx = sumProfIdx / totalAreaForScore;

  const farmerRawScore =
    0.5 * farmerProdIdx + 0.35 * farmerExpIdx + 0.15 * farmerProfIdx;
  const farmerScore = Math.min(100, (farmerRawScore / 150) * 100);

  // ── Village ranking by VADI score ──────────────────────────────────────────
  const allScores = [];
  for (const uid of villageUserIds) {
    const s = await computeVadiScoreForUserLight(uid, villageKey, last3);
    if (s != null) allScores.push({ user_id: uid, score: s });
  }
  allScores.sort((a, b) => b.score - a.score);
  const rankIndex = allScores.findIndex((r) => r.user_id === userId);
  const village_rank = rankIndex >= 0 ? rankIndex + 1 : null;

  return {
    farmer_vadi_score: Math.round(farmerScore),
    crop_vadi_scores: cropScores,
    production_index: Math.round(farmerProdIdx),
    expense_index: Math.round(farmerExpIdx),
    profit_index: Math.round(farmerProfIdx),
    village_rank,
    village_total_farmers: allScores.length,
    farmer_insights: Array.from(new Set(insights)).slice(0, 3),
    potential_income_improvement: Math.round(potentialIncomeImprovement),
    classification: classifyScore(farmerScore),
  };
}

// Lighter version used only for ranking – avoids recursion on full compute
async function computeVadiScoreForUserLight(userId, villageKey, last3) {
  const crops = await Crop.findAll({
    where: { user_id: userId, year: { [Op.in]: last3 } },
    raw: true,
  });
  if (!crops.length) return null;
  const cropIds = crops.map((c) => c.id);
  const [incomeRows, expenseRows] = await Promise.all([
    Income.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    }),
    Expense.findAll({
      attributes: ["crop_id", [fn("SUM", col("amount")), "total"]],
      where: { crop_id: { [Op.in]: cropIds } },
      group: ["crop_id"],
      raw: true,
    }),
  ]);
  const incomeByCrop = Object.fromEntries(
    incomeRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );
  const expenseByCrop = Object.fromEntries(
    expenseRows.map((r) => [r.crop_id, parseFloat(r.total) || 0])
  );

  const metrics = [];
  for (const c of crops) {
    const areaB = areaToBigha(c.area, c.area_unit);
    if (!areaB) continue;
    const inc = incomeByCrop[c.id] || 0;
    const exp = expenseByCrop[c.id] || 0;
    const prof = inc - exp;
    const prodPB = inc > 0 ? inc / areaB : 0;
    const expPB = exp / areaB;
    const profPB = prof / areaB;
    if (prodPB <= 0) continue;
    metrics.push({ areaB, prodPB, expPB, profPB });
  }
  if (!metrics.length) return null;

  let totalArea = 0;
  let sumProdIdx = 0;
  let sumExpIdx = 0;
  let sumProfIdx = 0;

  // Use simple village averages across all users in same village/crop/season
  for (const m of metrics) {
    // Treat village average as simple mean across all crops of same type in village
    // For ranking approximation, we just compare relative income/expense/profit per bigha.
    const prodAvg = metrics.reduce((a, x) => a + x.prodPB, 0) / metrics.length;
    const expAvg = metrics.reduce((a, x) => a + x.expPB, 0) / metrics.length;
    const profAvg = metrics.reduce((a, x) => a + x.profPB, 0) / metrics.length;
    if (!prodAvg) continue;

    const clamp = (v) => Math.max(0, Math.min(150, v || 0));
    const pIdx = clamp((m.prodPB / prodAvg) * 100);
    const eIdx =
      m.expPB > 0 ? clamp((expAvg / m.expPB) * 100) : 0;
    const prIdx =
      profAvg > 0 ? clamp((m.profPB / profAvg) * 100) : 0;

    totalArea += m.areaB;
    sumProdIdx += pIdx * m.areaB;
    sumExpIdx += eIdx * m.areaB;
    sumProfIdx += prIdx * m.areaB;
  }
  if (!totalArea) return null;
  const farmerProdIdx = sumProdIdx / totalArea;
  const farmerExpIdx = sumExpIdx / totalArea;
  const farmerProfIdx = sumProfIdx / totalArea;
  const rawScore =
    0.5 * farmerProdIdx + 0.35 * farmerExpIdx + 0.15 * farmerProfIdx;
  const finalScore = Math.min(100, (rawScore / 150) * 100);
  return finalScore;
}

module.exports = { computeVadiScoreForUser };

