const express = require("express");
const router = express.Router();
const carpoolController = require("../controller/carpool");
const { authMiddleware, optionalAuth } = require("../middleware/auth");

// ================= PUBLIC ROUTES =================
// Get all rooms (with optional status filter)
router.get("/rooms", carpoolController.getAllRooms);

// Get single room by ID
router.get("/rooms/:roomId", carpoolController.getRoom);

// Get nearby rooms (based on user location)
router.post("/rooms/nearby", carpoolController.getNearbyRooms);

// ================= PROTECTED ROUTES (require authentication) =================

// Create a new carpool room
router.post("/rooms/create", authMiddleware, carpoolController.createRoom);

// Join a carpool room
router.post("/rooms/:roomId/join", authMiddleware, carpoolController.joinRoom);

// Check in to a room
router.post(
  "/rooms/:roomId/checkin",
  authMiddleware,
  carpoolController.checkIn,
);

// Leave a room
router.post(
  "/rooms/:roomId/leave",
  authMiddleware,
  carpoolController.leaveRoom,
);

// Remove a passenger (driver only)
router.post(
  "/rooms/:roomId/remove-passenger",
  authMiddleware,
  carpoolController.removePassenger,
);

// Start ride (driver only)
router.post(
  "/rooms/:roomId/start",
  authMiddleware,
  carpoolController.startRide,
);

// Complete ride (driver only)
router.post(
  "/rooms/:roomId/complete",
  authMiddleware,
  carpoolController.completeRide,
);

// Delete room
router.delete("/rooms/:roomId", authMiddleware, carpoolController.deleteRoom);

// Get current user's active session
router.get("/my-session", authMiddleware, carpoolController.getMySession);

module.exports = router;
