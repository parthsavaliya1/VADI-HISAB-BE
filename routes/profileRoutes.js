const express = require("express");
const { FarmerProfile, User } = require("../models");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

function profileToBody(rec) {
  const p = rec.get ? rec.get({ plain: true }) : rec;
  const waterSources = Array.isArray(p.water_sources) ? p.water_sources : [];
  const labourTypes = Array.isArray(p.labour_types) ? p.labour_types : [];
  return {
    _id: p.id,
    user: p.user_id,
    name: p.name,
    district: p.district,
    taluka: p.taluka,
    village: p.village,
    totalLand: { value: parseFloat(p.total_land_value), unit: p.total_land_unit || "bigha" },
    waterSources,
    tractorAvailable: p.tractor_available,
    implementsAvailable: p.implements_available || [],
    labourTypes,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}

router.post("/complete", auth, async (req, res) => {
  try {
    const existing = await FarmerProfile.findOne({ where: { user_id: req.user.id } });
    if (existing) {
      return res.status(400).json({
        message: "Profile already exists. Use PUT /api/profile/update to edit it.",
      });
    }
    const {
      name,
      district,
      taluka,
      village,
      totalLand,
      waterSources,
      tractorAvailable,
      implementsAvailable,
      labourTypes,
    } = req.body;

    const profile = await FarmerProfile.create({
      user_id: req.user.id,
      name,
      district,
      taluka,
      village,
      total_land_value: totalLand?.value ?? 0,
      total_land_unit: totalLand?.unit ?? "bigha",
      water_sources: Array.isArray(waterSources) ? waterSources : [],
      tractor_available: tractorAvailable,
      implements_available: Array.isArray(implementsAvailable) ? implementsAvailable : [],
      labour_types: Array.isArray(labourTypes) ? labourTypes : [],
    });

    await User.update({ is_profile_completed: true }, { where: { id: req.user.id } });
    res.status(201).json({ message: "Profile saved successfully", profile: profileToBody(profile) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const profile = await FarmerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) {
      return res.status(404).json({ message: "Profile not found. Please complete your profile." });
    }
    res.json({ profile: profileToBody(profile) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/update", auth, async (req, res) => {
  try {
    const updates = {};
    if (req.body.totalLand) {
      updates.total_land_value = req.body.totalLand.value;
      updates.total_land_unit = req.body.totalLand.unit || "bigha";
    }
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.district !== undefined) updates.district = req.body.district;
    if (req.body.taluka !== undefined) updates.taluka = req.body.taluka;
    if (req.body.village !== undefined) updates.village = req.body.village;
    if (req.body.waterSources !== undefined) updates.water_sources = Array.isArray(req.body.waterSources) ? req.body.waterSources : [];
    if (req.body.tractorAvailable !== undefined) updates.tractor_available = req.body.tractorAvailable;
    if (req.body.implementsAvailable !== undefined) updates.implements_available = Array.isArray(req.body.implementsAvailable) ? req.body.implementsAvailable : [];
    if (req.body.labourTypes !== undefined) updates.labour_types = Array.isArray(req.body.labourTypes) ? req.body.labourTypes : [];
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: "No valid fields provided to update." });
    }
    const profile = await FarmerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) return res.status(404).json({ message: "Profile not found." });
    await profile.update(updates);
    res.json({ message: "Profile updated successfully", profile: profileToBody(profile) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
