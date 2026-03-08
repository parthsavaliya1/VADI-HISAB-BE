/**
 * Location API: districts, talukas, villages (Gujarat reference data)
 * GET /api/locations/districts
 * GET /api/locations/talukas?district=Rajkot
 * GET /api/locations/villages?district=Rajkot&taluka=Gondal
 */
const express = require("express");
const NodeCache = require("node-cache");
const { Location } = require("../models");

const router = express.Router();
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hours

router.get("/districts", async (req, res) => {
  const key = "locations:districts";
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const rows = await Location.findAll({
      where: { type: "district" },
      order: [["value", "ASC"]],
      attributes: ["value", "label"],
    });
    const data = rows.map((r) => ({ value: r.value, label: r.label }));
    cache.set(key, data);
    res.json(data);
  } catch (err) {
    console.error("locations/districts", err);
    res.status(500).json({ error: "માહિતી લોડ થઈ શકી નથી" });
  }
});

router.get("/talukas", async (req, res) => {
  const district = req.query.district;
  if (!district) return res.status(400).json({ error: "district query required" });

  const key = `locations:talukas:${district}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const rows = await Location.findAll({
      where: { type: "taluka", district_value: district },
      order: [["value", "ASC"]],
      attributes: ["value", "label"],
    });
    const data = rows.map((r) => ({ value: r.value, label: r.label }));
    cache.set(key, data);
    res.json(data);
  } catch (err) {
    console.error("locations/talukas", err);
    res.status(500).json({ error: "માહિતી લોડ થઈ શકી નથી" });
  }
});

router.get("/villages", async (req, res) => {
  const district = req.query.district;
  const taluka = req.query.taluka;
  if (!district || !taluka) return res.status(400).json({ error: "district and taluka query required" });

  const key = `locations:villages:${district}:${taluka}`;
  const cached = cache.get(key);
  if (cached) return res.json(cached);

  try {
    const rows = await Location.findAll({
      where: { type: "village", district_value: district, taluka_value: taluka },
      order: [["value", "ASC"]],
      attributes: ["value", "label"],
    });
    const data = rows.map((r) => ({ value: r.value, label: r.label }));
    cache.set(key, data);
    res.json(data);
  } catch (err) {
    console.error("locations/villages", err);
    res.status(500).json({ error: "માહિતી લોડ થઈ શકી નથી" });
  }
});

module.exports = router;
