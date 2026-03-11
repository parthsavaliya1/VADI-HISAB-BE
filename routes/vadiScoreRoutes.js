const express = require("express");
const router = express.Router();
const asyncHandler = require("express-async-handler");
const auth = require("../middleware/authMiddleware");
const { computeVadiScoreForUser } = require("../services/vadiScoreService");

// GET /vadi-score/me — compute VADI score for current farmer
router.get(
  "/me",
  auth,
  asyncHandler(async (req, res) => {
    const result = await computeVadiScoreForUser(req.user.id);
    res.json(result);
  })
);

module.exports = router;

