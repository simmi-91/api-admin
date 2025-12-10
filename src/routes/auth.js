import express from "express";
import dbPool from "../database.js";
import jwt from "jsonwebtoken";

import { verifyGoogleToken } from "../service/googleAuth.js";
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = "7d";

const LOCAL_TEST_ID = process.env.LOCAL_TEST_ID;
const LOCAL_TEST_EMAIL = process.env.LOCAL_TEST_EMAIL;

router.get("/", requireAuth, verifyAdmin, async (req, res) => {
  try {
    const [users] = await dbPool.query(
      "SELECT id, googleId, email, name, isAdmin, createdAt, updatedAt FROM users"
    );
    res.json({ users });
  } catch (error) {
    console.error("Database error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch user list." });
  }
});

router.post("/login", async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Google ID token is required." });
  }

  let googleId = LOCAL_TEST_ID;
  let email = LOCAL_TEST_EMAIL;

  if (token !== "LOCAL_TEST") {
    const payload = await verifyGoogleToken(token);
    if (!payload) {
      return res
        .status(401)
        .json({ error: "Invalid or expired Google token." });
    }
    googleId = payload.sub;
    email = payload.email;
  }

  try {
    const [rows] = await dbPool.query(
      "SELECT id, googleId, email, name, isAdmin FROM users WHERE googleId = ? OR email = ?",
      [googleId, email]
    );

    const user = rows[0];
    if (!user) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    if (user.isAdmin !== 1) {
      return res.status(403).json({
        error: "Access denied. Only administrators can log in.",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        googleId: user.googleId,
        email: user.email,
        isAdmin: true,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    const decodedToken = jwt.decode(token);
    const expiresAt = decodedToken.exp * 1000;

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, isAdmin: true },
      expiresAt: expiresAt,
    });
  } catch (error) {
    console.error("Database error during login:", error);
    res
      .status(500)
      .json({ error: "Internal server error during authentication." });
  }
});

router.get("/logout", async (req, res) => {
  res.status(304).json({ message: "logout users route not defined" });
});

export default router;
