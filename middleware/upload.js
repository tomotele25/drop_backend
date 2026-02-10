const multer = require("multer");
const {
  driverPhotoStorage,
  packageImageStorage,
} = require("../utils/cloudinary");

const uploadDriverPhoto = multer({ storage: driverPhotoStorage });
const uploadPackageImage = multer({ storage: packageImageStorage });

module.exports = {
  uploadDriverPhoto,
  uploadPackageImage,
};
