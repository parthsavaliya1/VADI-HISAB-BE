const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const { User, FarmerProfile } = require("../models");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

function toUserResponse(user, profileConsent = null) {
  const u = user.get ? user.get({ plain: true }) : user;
  const analyticsConsent = profileConsent !== undefined ? profileConsent : u.analytics_consent;
  return {
    _id: u.id,
    id: u.id,
    phone: u.phone,
    role: u.role,
    isProfileCompleted: u.is_profile_completed,
    analyticsConsent,
    lastActiveAt: u.last_active_at,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  };
}

router.post("/send-otp", async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.length !== 10) {
    return res.status(400).json({ message: "Valid 10-digit phone number required" });
  }
  try {
    const response = await axios.get(
      `https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/${phone}/AUTOGEN`
    );
    if (response.data.Status !== "Success") {
      return res.status(500).json({ message: "OTP send failed", details: response.data });
    }
    return res.json({ message: "OTP sent successfully", sessionId: response.data.Details });
  } catch (error) {
    return res.status(500).json({ message: "OTP send error", error: error.message });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { phone, otp, sessionId } = req.body;
  console.log("verify-otp: phone", phone, "otp", otp, "sessionId", sessionId);
  if (!phone || !otp || !sessionId) {
    return res.status(400).json({ message: "phone, otp, and sessionId are required" });
  }
  try {
    console.log("verify-otp: TWO_FACTOR_API_KEY", process.env.TWO_FACTOR_API_KEY);
    if (!process.env.TWO_FACTOR_API_KEY) {
      console.error("verify-otp: TWO_FACTOR_API_KEY is missing");
      return res.status(500).json({ message: "Server configuration error" });
    }
    const response = await axios.get(
      `https://2factor.in/API/V1/${process.env.TWO_FACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`,
      { timeout: 15000 }
    );
    if (response.data.Status !== "Success") {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }
    let user = await User.findOne({ where: { phone } });
    const isNewUser = !user;
    if (!user) {
      user = await User.create({ phone, last_active_at: new Date() });
    } else {
      await User.update(
        { last_active_at: new Date() },
        { where: { id: user.id } }
      );
      user.last_active_at = new Date();
    }
    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    const profile = await FarmerProfile.findOne({ where: { user_id: user.id }, attributes: ["data_sharing"] });
    const consentGiven = profile ? (profile.data_sharing != null) : (user.analytics_consent != null);
    return res.json({
      token,
      isNewUser,
      isProfileCompleted: user.is_profile_completed,
      consentGiven,
    });
  } catch (error) {
    console.error("verify-otp error:", error.message);
    if (error.response && error.response.status === 400) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }
    return res.status(500).json({
      message: "Verification failed. Please try again.",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

router.post("/consent", auth, async (req, res) => {
  const { consent } = req.body;
  if (typeof consent !== "boolean") {
    return res.status(400).json({ message: "consent must be true or false" });
  }
  try {
    const profile = await FarmerProfile.findOne({ where: { user_id: req.user.id } });
    if (!profile) return res.status(404).json({ message: "Profile not found. Complete profile first." });
    await profile.update({ data_sharing: consent });
    return res.json({ message: "Consent saved", analyticsConsent: profile.data_sharing });
  } catch (error) {
    return res.status(500).json({ message: "Consent save error", error: error.message });
  }
});

router.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    const profile = await FarmerProfile.findOne({ where: { user_id: req.user.id }, attributes: ["data_sharing"] });
    const profileConsent = profile?.data_sharing;
    return res.json({ user: toUserResponse(user, profileConsent) });
  } catch (error) {
    return res.status(500).json({ message: "Error fetching user", error: error.message });
  }
});

module.exports = router;
