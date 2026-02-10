const {createRider,getRiderStatus,toggleRiderStatus} = require("../controller/rider");
const express = require("express");
const { uploadDriverPhoto } = require("../middleware/upload");
const router = express.Router();

router.post("/riders", uploadDriverPhoto.single("profileImg"), createRider);

router.get("/riders/:id/status", getRiderStatus);
router.patch("/riders/:id/toggleStatus", toggleRiderStatus);

module.exports = router;
