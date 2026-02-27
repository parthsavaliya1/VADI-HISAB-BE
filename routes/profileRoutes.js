const express = require("express");
const FarmerProfile = require("../models/FarmerProfile");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// ─────────────────────────────────────────────
// 📝 COMPLETE PROFILE (First time)
// POST /api/profile/complete
// Header: Authorization: Bearer <token>
// Body: all farmer fields
// ─────────────────────────────────────────────
router.post("/complete", auth, async (req, res) => {
    try {
        // Prevent duplicate profile
        const existing = await FarmerProfile.findOne({ user: req.user.id });
        if (existing) {
            return res.status(400).json({ message: "Profile already exists. Use PUT /api/profile/update" });
        }

        const profile = await FarmerProfile.create({
            user: req.user.id,
            ...req.body,
        });

        await User.findByIdAndUpdate(req.user.id, {
            isProfileCompleted: true,
        });

        res.json({ message: "Profile Saved", profile });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// 👤 GET MY PROFILE
// GET /api/profile/me
// Header: Authorization: Bearer <token>
// ─────────────────────────────────────────────
router.get("/me", auth, async (req, res) => {
    try {
        const profile = await FarmerProfile.findOne({ user: req.user.id });
        if (!profile) return res.status(404).json({ message: "Profile not found" });
        res.json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ─────────────────────────────────────────────
// ✏️ UPDATE PROFILE
// PUT /api/profile/update
// Header: Authorization: Bearer <token>
// Body: fields to update
// ─────────────────────────────────────────────
router.put("/update", auth, async (req, res) => {
    try {
        const profile = await FarmerProfile.findOneAndUpdate(
            { user: req.user.id },
            { ...req.body },
            { new: true, runValidators: true }
        );

        if (!profile) return res.status(404).json({ message: "Profile not found" });

        res.json({ message: "Profile Updated", profile });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;