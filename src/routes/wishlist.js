import express from "express";
import dbPool from "../database.js";

import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await dbPool.query(
      "SELECT * FROM wishlist ORDER BY createdAt DESC"
    );

    res.json({ items: rows });
  } catch (error) {
    console.error("Database error fetching wishlist items:", error);
    res.status(500).json({
      error: "Failed to retrieve wishlist items due to a server error.",
    });
  }
});

router.post("/", requireAuth, verifyAdmin, async (req, res) => {
  const { title, description, category, active } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const itemTitle = title;
  const itemDescription = description || null;
  const itemCategory = category || 0;
  const itemActive = active || 0;

  const now = new Date().toISOString().slice(0, 19).replace("T", " "); // Format for MySQL DATETIME

  try {
    const sql = `
      INSERT INTO wishlist 
      (title, description, category, active, createdAt, updated) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    const values = [
      itemTitle,
      itemDescription,
      itemCategory,
      itemActive,
      now,
      now,
    ];

    const [result] = await dbPool.query(sql, values);

    const newId = result.insertId;

    const newItem = {
      id: newId,
      title: itemTitle,
      description: itemDescription,
      category: itemCategory,
      active: itemActive,
      createdAt: now,
      updated: now,
    };

    res.status(201).json(newItem);
  } catch (error) {
    // MySQL error code 1062 = duplicate entry key violation
    if (error.code === "ER_DUP_ENTRY") {
      console.warn(`Attempted to insert duplicate title: "${itemTitle}"`);
      return res.status(409).json({
        error: "A wishlist item with this title already exists.",
      });
    }

    console.error("Database error creating new wishlist item:", error);
    res.status(500).json({
      error: "Failed to create wishlist item due to a server error.",
      sqlMessage: error.sqlMessage,
    });
  }
});

router.put("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { title, description, category, active } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const itemTitle = title;
  const itemDescription = description || null;
  const itemCategory = category || 0;
  const itemActive = active || 0;

  try {
    const sql = `
      UPDATE wishlist 
      SET title=?, description=?, category=?, active=?, updated=?
      WHERE id=?
    `;

    const values = [
      itemTitle,
      itemDescription,
      itemCategory,
      itemActive,
      now,
      id,
    ];

    const [result] = await dbPool.query(sql, values);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Wishlist item not found." });
    }

    const updatedItem = {
      id: parseInt(id),
      title: itemTitle,
      description: itemDescription,
      category: itemCategory,
      active: itemActive,
      updated: now,
    };
    res.status(200).json(updatedItem);
  } catch (error) {
    console.error("Database error updating wishlist item:", error);
    res.status(500).json({
      error: "Failed to update wishlist item due to a server error.",
      sqlMessage: error.sqlMessage,
    });
  }
});

router.delete("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await dbPool.query("DELETE FROM wishlist WHERE id = ?", [id]);
  } catch (error) {
    console.error("Database error deleting wishlist item:", error);
    res.status(500).json({
      error: "Failed to delete wishlist item due to a server error.",
      sqlMessage: error.sqlMessage,
    });
  }

  res.status(200).json({ message: "Wishlist item deleted" });
});

export default router;
