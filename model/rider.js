const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const slugify = require("slugify");

const riderSchema = new mongoose.Schema(
  {
    fullname: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    carColor: {
      type: String,
      required: true,
    },
    carModel: {
      type: String,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    plateNo: {
      type: String,
      required: true,
      unique: true,
    },
    profileImg: {
      type: String,
      default: "",
    },
    contact: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    currentLocation: {
      latitude: { type: Number, default: 0 },
      longitude: { type: Number, default: 0 },
      address: { type: String },
    },
    trips: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Trip",
      },
    ],
  },
  { timestamps: true }
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

riderSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

module.exports = mongoose.models.Rider || mongoose.model("Rider", riderSchema);
