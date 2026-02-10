const Parcel = require("../model/percel");
const axios = require("axios");

const sendPackage = async (req, res) => {
  try {
    const {
      pickup,
      destination,
      senderPhone,
      receiverPhone,
      message,
      paymentBy,
      express,
    } = req.body;

 
    if (
      !pickup ||
      !destination ||
      !senderPhone ||
      !receiverPhone ||
      !paymentBy
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const pickupGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: pickup,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );

    if (!pickupGeo.data.results.length) {
      return res.status(400).json({
        success: false,
        message: "Could not find pickup location",
      });
    }

    const pickupCoordinates = {
      lat: pickupGeo.data.results[0].geometry.location.lat,
      lng: pickupGeo.data.results[0].geometry.location.lng,
    };

   
    const destinationGeo = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: destination,
          key: process.env.GOOGLE_MAPS_API_KEY,
        },
      },
    );

    if (!destinationGeo.data.results.length) {
      return res.status(400).json({
        success: false,
        message: "Could not find destination location",
      });
    }

    const destinationCoordinates = {
      lat: destinationGeo.data.results[0].geometry.location.lat,
      lng: destinationGeo.data.results[0].geometry.location.lng,
    };


    const newParcel = new Parcel({
      pickup,
      destination,
      pickupCoordinates,
      destinationCoordinates,
      senderPhone: senderPhone,
      receiverPhone: receiverPhone,
      message: message || "",
      paymentBy,
      exness: express || false,
    });

    await newParcel.save();

    return res.status(201).json({
      success: true,
      message: "Parcel created successfully",
      parcel: newParcel,
    });
  } catch (error) {
    console.error("sendPackage error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Could not create parcel.",
    });
  }
};

module.exports = {sendPackage};
