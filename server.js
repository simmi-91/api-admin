import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import authRoutes from "./src/routes/auth.js";
import wishlistRoutes from "./src/routes/wishlist.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions = {
  origin: allowedOrigins.length ? allowedOrigins : true,
};
app.use(cors(corsOptions));
app.use(express.json());
//app.use(express.static("test-public"));

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Routes
app.use("/auth", authRoutes);
app.use("/wishlist", wishlistRoutes);

// Start server (skip in test mode)
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
