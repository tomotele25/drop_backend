const createRider = require("../controller/rider");
const express = require("express");

const router = express.Router();

router.post("/riders", createRider);

module.exports = router;
