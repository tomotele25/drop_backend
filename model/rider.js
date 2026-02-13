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

    // <-- Add this
    slug: { type: String, unique: true },
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

module.exports = mongoose.model("Rider", riderSchema);
