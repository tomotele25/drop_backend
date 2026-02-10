const express = require("express");
const router = express.Router();
const {sendPackage} = require("../controller/percel")



router.post("/percel",sendPackage)

module.exports = router