// One-off: re-save the live PricingConfig doc with the current basic/
// comfort/premium field names — the doc still has the old standard/premium
// keys from before the rename, so `basic`/`comfort` were falling back to
// defaults. Keeps every other current value (perKm, perMinute, surge, etc.)
// untouched — only fixes the baseFares shape.
require("dotenv").config();
const mongoose = require("mongoose");
const PricingConfig = require("../model/pricingConfig");

async function main() {
  await mongoose.connect(process.env.DB_URL, { serverSelectionTimeoutMS: 15000 });

  let doc = await PricingConfig.findOne();
  if (!doc) {
    console.log("No PricingConfig doc exists yet — nothing to re-save, it'll seed itself on first read.");
    await mongoose.disconnect();
    return;
  }

  const old = doc.toObject();
  console.log("Before:", JSON.stringify(old.baseFares));

  doc.baseFares = {
    basic: old.baseFares?.basic ?? old.baseFares?.standard ?? 1100,
    comfort: old.baseFares?.comfort ?? 2200,
    premium: old.baseFares?.premium ?? 3400,
  };

  await doc.save();
  console.log("After: ", JSON.stringify(doc.baseFares));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("resavePricing failed:", err);
  process.exit(1);
});
