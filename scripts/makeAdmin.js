// One-off CLI to promote an existing account to admin — there's no admin
// signup flow (signup always defaults to role: "customer"), so this is the
// one-time manual step to get your first admin account.
//
// Usage: node scripts/makeAdmin.js <email-or-contact>
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../model/user");

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error("Usage: node scripts/makeAdmin.js <email-or-contact>");
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URL, { serverSelectionTimeoutMS: 15000 });

  const user = await User.findOne({
    $or: [{ email: identifier }, { contact: identifier }],
  });

  if (!user) {
    console.log(`No account found for "${identifier}". Sign up in the app first, then run this again.`);
    await mongoose.disconnect();
    return;
  }

  user.role = "admin";
  await user.save();

  console.log(`✅ ${user.fullname} (${user.email}) is now an admin.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("makeAdmin failed:", err);
  process.exit(1);
});
