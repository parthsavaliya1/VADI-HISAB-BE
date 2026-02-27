const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

// ─────────────────────────────────────────────
// 📤 SEND OTP
// POST /api/auth/send-otp
// Body: { phone }
// ─────────────────────────────────────────────
router.post("/send-otp", async (req, res) => {
    const { phone } = req.body;

    if (!phone || phone.length !== 10) {
        return res.status(400).json({ message: "Valid 10-digit phone required" });
    }

    try {
        const response = await axios.get(
            `https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${phone}/AUTOGEN`
        );

        // 2Factor returns { Status: "Success", Details: "SESSION_ID" }
        if (response.data.Status !== "Success") {
            return res.status(500).json({ message: "OTP send failed", details: response.data });
        }

        return res.json({
            message: "OTP sent successfully",
            sessionId: response.data.Details, // Send sessionId to frontend
        });
    } catch (error) {
        return res.status(500).json({ message: "OTP send error", error: error.message });
    }
});

// ─────────────────────────────────────────────
// ✅ VERIFY OTP
// POST /api/auth/verify-otp
// Body: { phone, otp, sessionId }
// ─────────────────────────────────────────────
router.post("/verify-otp", async (req, res) => {
    const { phone, otp, sessionId } = req.body;

    if (!phone || !otp || !sessionId) {
        return res.status(400).json({ message: "phone, otp, and sessionId are required" });
    }

    try {
        // Verify OTP with 2Factor
        const response = await axios.get(
            `https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`
        );

        if (response.data.Status !== "Success") {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        // Find or create user
        let user = await User.findOne({ phone });
        const isNewUser = !user;

        if (!user) {
            user = await User.create({ phone });
        }

        const token = jwt.sign(
            { id: user._id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.json({
            token,
            isNewUser,                              // true = show profile form
            isProfileCompleted: user.isProfileCompleted,
            consentGiven: user.analyticsConsent !== null, // true = consent already done
        });
    } catch (error) {
        return res.status(500).json({ message: "OTP verify error", error: error.message });
    }
});

// ─────────────────────────────────────────────
// 📜 SAVE CONSENT (First login only)
// POST /api/auth/consent
// Body: { consent: true/false }
// Header: Authorization: Bearer <token>
// ─────────────────────────────────────────────
router.post("/consent", auth, async (req, res) => {
    const { consent } = req.body;

    if (typeof consent !== "boolean") {
        return res.status(400).json({ message: "consent must be true or false" });
    }

    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { analyticsConsent: consent },
            { new: true }
        );

        return res.json({
            message: "Consent saved",
            analyticsConsent: user.analyticsConsent,
        });
    } catch (error) {
        return res.status(500).json({ message: "Consent save error", error: error.message });
    }
});

module.exports = router;