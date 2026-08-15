const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const slugify = require("slugify");

const locationSchema = new mongoose.Schema(
  {
    latitude: { type: Number, default: 0 },
    longitude: { type: Number, default: 0 },
  },
  { _id: false },
);

const riderSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    carColor: { type: String, required: true },
    carModel: { type: String, required: true },
    plateNo: { type: String, required: true, unique: true },
    profileImg: { type: String, default: "" },
    contact: { type: String, required: true },
    licenseNo: { type: String, required: true },
    dob: { type: String, required: false },
    address: { type: String, required: true },
    emergencyContact: { type: String, required: true },
    bvn: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: false },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    trips: [{ type: mongoose.Schema.Types.ObjectId, ref: "Trip" }],
    currentLocation: { type: locationSchema, default: () => ({}) },

    // GeoJSON mirror of currentLocation, kept in sync on every location
    // write. currentLocation stays as-is since it's read as
    // .latitude/.longitude in many places already — this field exists
    // purely so proximity queries can use a real 2dsphere index instead of
    // fetching every active driver citywide and Haversine-filtering in JS.
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], default: [0, 0] }, // [lng, lat]
    },

    // <-- Add this
    slug: { type: String, unique: true },

    // Payout bank details — required before a driver can receive a batch settlement.
    bankCode: { type: String, default: null },
    bankName: { type: String, default: null },
    accountNumber: { type: String, default: null },
    accountName: { type: String, default: null },
    paystackRecipientCode: { type: String, default: null },
  },
  { timestamps: true },
);


riderSchema.pre("save", async function (next) {
  if (!this.isModified("fullname")) return next();

  const Rider = mongoose.models.Rider || mongoose.model("Rider", riderSchema);
  let baseSlug = slugify(this.fullname, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (await Rider.exists({ slug })) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  this.slug = slug;
  next();
});

riderSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Rider", riderSchema);
