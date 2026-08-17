const {
  createRider,
  getRiderStatus,
  toggleRiderStatus,
  updateRiderProfile,
} = require("../controller/rider");
const express = require("express");
const upload = require("../middleware/upload");
const { authenticateToken } = require("../middleware/riders");
const router = express.Router();

router.post(
  "/riders",
  upload.fields([
    { name: "profileImg", maxCount: 1 },
    { name: "vehiclePhoto", maxCount: 1 },
    { name: "licensePhoto", maxCount: 1 },
    { name: "plateNoPhoto", maxCount: 1 },
  ]),
  createRider,
);
router.get("/riders/:id/status", authenticateToken, getRiderStatus);
router.patch("/riders/:id/toggleStatus", authenticateToken, toggleRiderStatus);
router.patch("/riders/:id/profile", authenticateToken, upload.single("profileImg"), updateRiderProfile);

module.exports = router;
