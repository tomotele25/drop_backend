const {
  createRider,
  getRiderStatus,
  toggleRiderStatus,
} = require("../controller/rider");
const express = require("express");
const upload = require("../middleware/upload");
const { authenticateToken } = require("../middleware/riders");
const router = express.Router();

router.post("/riders", upload.single("profileImg"), createRider);
router.get("/riders/:id/status", authenticateToken, getRiderStatus);
router.patch("/riders/:id/toggleStatus", authenticateToken, toggleRiderStatus);

module.exports = router;
