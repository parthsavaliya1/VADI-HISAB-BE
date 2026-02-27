const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true,
            unique: true,
        },
        role: {
            type: String,
            default: "farmer",
        },
        isProfileCompleted: {
            type: Boolean,
            default: false,
        },
        analyticsConsent: {
            type: Boolean,
            default: null, // null = not yet asked
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);