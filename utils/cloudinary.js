const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* DRIVER PROFILE PHOTO */
const driverPhotoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "drop/drivers",
    allowed_formats: ["jpg", "png", "jpeg"],
    transformation: [{ width: 400, height: 400, crop: "fill" }],
  },
});

/* PACKAGE / PRODUCT IMAGE */
const packageImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "drop/packages",
    allowed_formats: ["jpg", "png", "jpeg"],
    transformation: [{ width: 600, height: 600, crop: "limit" }],
  },
});

module.exports = {
  cloudinary,
  driverPhotoStorage,
  packageImageStorage,
};
