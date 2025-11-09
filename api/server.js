const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const PORT = 8001;
const app = express();
const connectToDb = require("../database/db");
const authRoute = require("../routes/authRoute");
const rideRoute = require("../routes/rideRoute");
const riderRoute = require("../routes/riderRoute");

const allowedOrigins = ["http://localhost:3000", "https://drop-red.vercel.app"];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origin not allowed"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  console.log("test route hit");
  res.send("Hello world");
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: allowedOrigins },
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("joinRideRoom", (rideId) => {
    socket.join(rideId);
    console.log(`Socket ${socket.id} joined room ${rideId}`);
  });

  socket.on("leaveRideRoom", (rideId) => {
    socket.leave(rideId);
    console.log(`Socket ${socket.id} left room ${rideId}`);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const broadcastSeatUpdate = (rideId, availableSeats) => {
  io.to(rideId).emit("seatsUpdated", availableSeats);
};

app.set("io", io);
app.set("broadcastSeatUpdate", broadcastSeatUpdate);

const startServer = async () => {
  try {
    await connectToDb();
    console.log("Database connected");

    app.use("/api", authRoute);
    app.use("/api", rideRoute);
    app.use("/api", riderRoute);

    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error("Failed to start server:", err);
  }
};

startServer();

module.exports = app;
