const express = require("express");
const router = express.Router();
const carpoolController = require("../controller/carpool");
const { authMiddleware, optionalAuth } = require("../middleware/auth");
const authorizeRole = require("../middleware/role");
const { bookingLimiter } = require("../middleware/rateLimit");

// ================= PUBLIC ROUTES =================

// Get all rooms (with optional status filter)
router.get("/rooms", carpoolController.getAllRooms);

// Get single room by ID
router.get("/rooms/:roomId", carpoolController.getRoom);

// Get nearby rooms (based on user location)
router.post("/rooms/nearby", carpoolController.getNearbyRooms);

// ================= PROTECTED ROUTES (require authentication) =================

// Get current user's active session
router.get("/my-session", authMiddleware, carpoolController.getMySession);

// Get driver's assigned/active carpool rooms
router.get("/driver/rooms", authMiddleware, carpoolController.getDriverRooms);

// Create a new carpool room
router.post("/rooms/create", authMiddleware, bookingLimiter, carpoolController.createRoom);

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
// Soft-cancel (status -> "cancelled"), not a hard delete — see cancelRoom.
// Kept on DELETE for backward compatibility; POST /cancel is the preferred
// path going forward, matching the ride cancellation convention.
router.delete("/rooms/:roomId", authMiddleware, carpoolController.cancelRoom);
router.post("/rooms/:roomId/cancel", authMiddleware, carpoolController.cancelRoom);

// Manually assign a specific driver to a room (admin only)
router.post(
  "/rooms/:roomId/assign-driver",
  authMiddleware,
  authorizeRole("admin"),
  carpoolController.assignDriver,
);

// Re-trigger automatic driver search for a waiting room
router.post(
  "/rooms/:roomId/retry-search",
  authMiddleware,
  authorizeRole("admin"),
  carpoolController.retryDriverSearch,
);

module.exports = router;
