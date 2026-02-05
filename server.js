import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";

import authRoutes from "./src/routes/auth.js";
import wishlistRoutes from "./src/routes/wishlist.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware - CORS Configuration
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins =
  process.env.NODE_ENV === "production"
    ? []
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
      ];

const corsOrigin = allowedOrigins.length ? allowedOrigins : defaultOrigins;

if (process.env.NODE_ENV === "production" && corsOrigin.length === 0) {
  console.warn(
    "CORS WARNING: FRONTEND_ORIGINS not configured in production. API will reject cross-origin requests.",
  );
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (corsOrigin.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  allowedHeaders: ["Content-Type", "Authorization", "X-Custom-Header"],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
//app.use(express.static("test-public"));

// Health check route
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const SIMULATE_DELAY = process.env.NODE_ENV === "development";
const DELAY_MS = 2000;
app.use(async (req, res, next) => {
  if (SIMULATE_DELAY) {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  next();
});

// Routes
app.use("/auth", authRoutes);
app.use("/wishlist", wishlistRoutes);

if (process.env.NODE_ENV !== "production") {
  const uploadsPath = path.join(process.cwd(), "uploads");
  app.use("/uploads", express.static(uploadsPath));
  console.log(`Serving uploads from: ${uploadsPath}`);
}

// Start server (skip in test mode)
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
