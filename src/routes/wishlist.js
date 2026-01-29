import express from "express";
import dbPool from "../database.js";
import multer from "multer";

import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";
import {
  wishlistUpload,
  listAllImages,
  uploadToR2,
  deleteFromR2,
  deleteManyFromR2,
  createFullImageUrl,
} from "../service/imageProvider.js";

const router = express.Router();

// Resource - WISHLIST
router.get("/active", async (req, res) => {
  try {
    const [rows] = await dbPool.query(`
      SELECT 
        w.*, 
        i.id AS image_id, 
        i.image_path, 
        i.image_type,
        i.display_order
      FROM wishlist w
      LEFT JOIN wish_images i ON w.id = i.wish_id
      WHERE w.active=1
      ORDER BY w.createdAt DESC, i.display_order ASC
    `);

    const wishlistMap = {};
    rows.forEach((row) => {
      if (!wishlistMap[row.id]) {
        wishlistMap[row.id] = {
          ...row,
          images: [],
        };
        delete wishlistMap[row.id].image_id;
        delete wishlistMap[row.id].image_path;
        delete wishlistMap[row.id].display_order;
        delete wishlistMap[row.id].image_type;
      }

      if (row.image_id) {
        wishlistMap[row.id].images.push({
          id: row.image_id,
          path: row.image_path,
          display_order: row.display_order,
          image_type: row.image_type,
          url: createFullImageUrl(row.image_path, row.image_type),
        });
      }
    });

    res.json(Object.values(wishlistMap));
  } catch (error) {
    console.error("Database error fetching wishlist items:", error);
    res.status(500).json({
      error: "Failed to retrieve wishlist items due to a server error.",
    });
  }
});

router.get("/", requireAuth, async (req, res) => {
  try {
    const [rows] = await dbPool.query(`
      SELECT 
        w.*, 
        i.id AS image_id, 
        i.image_path, 
        i.image_type,
        i.display_order
      FROM wishlist w
      LEFT JOIN wish_images i ON w.id = i.wish_id
      ORDER BY w.createdAt DESC, i.display_order ASC
    `);

    const wishlistMap = {};
    rows.forEach((row) => {
      if (!wishlistMap[row.id]) {
        wishlistMap[row.id] = {
          ...row,
          images: [],
        };
        delete wishlistMap[row.id].image_id;
        delete wishlistMap[row.id].image_path;
        delete wishlistMap[row.id].display_order;
        delete wishlistMap[row.id].image_type;
      }

      if (row.image_id) {
        wishlistMap[row.id].images.push({
          id: row.image_id,
          path: row.image_path,
          display_order: row.display_order,
          image_type: row.image_type,
          url: createFullImageUrl(row.image_path, row.image_type),
        });
      }
    });

    res.json(Object.values(wishlistMap));
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

// Resource - GALLERY
router.get("/images/gallery", requireAuth, async (req, res) => {
  try {
    const images = await listAllImages();
    res.json(images);
  } catch (error) {
    console.error("Error on fetching from R2 bucket:", error);
    res.status(500).json({ error: "Failed to fetch gallery" });
  }
});

router.delete(
  "/images/gallery/:imagePath",
  requireAuth,
  verifyAdmin,
  async (req, res) => {
    const { imagePath } = req.params;

    if (!imagePath) {
      return res
        .status(400)
        .json({ error: "imagePath is required to deltete an existing image" });
    }

    try {
      const [rows] = await dbPool.query(
        "SELECT id FROM wish_images WHERE image_path = ? AND image_type = 'r2'",
        [imagePath],
      );
      if (rows.length > 0) {
        await dbPool.query("DELETE FROM wish_images WHERE image_path = ?", [
          imagePath,
        ]);
      }

      await deleteFromR2(imagePath);

      res.status(200).json({ message: "Image deleted from R2 and database." });
    } catch (error) {
      console.error("Error on deleting:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Resource - SINGLE WISH
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

// Resource - IMAGES CONNECTED TO WISHES
router.get("/:id/images", requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await dbPool.query(
      "SELECT * FROM wish_images WHERE wish_id = ? ORDER BY wish_id ASC, display_order ASC",
      [id],
    );

    res.json(rows);
  } catch (error) {
    console.error("Database error fetching wishlist images:", error);
    res.status(500).json({
      error: "Failed to retrieve wishlist images due to a server error.",
    });
  }
});

router.post(
  "/:id/images",
  requireAuth,
  verifyAdmin,
  (req, res, next) => {
    wishlistUpload.single("image")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              error: "File too large. Maximum size is 5MB.",
            });
          }
          return res.status(400).json({ error: err.message });
        }

        if (err.message === "Only image files are allowed") {
          return res.status(400).json({
            error: "Only image files are allowed (jpeg, jpg, png, gif, webp)",
          });
        }

        return res.status(500).json({ error: err.message });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { id } = req.params;
      const { filename } = req.body;
      const customName = filename || "";

      const r2Data = await uploadToR2(req.file, customName);

      const [result] = await dbPool.query(
        `INSERT INTO wish_images (wish_id, image_type, image_path, created_at, display_order) 
       VALUES (
        ?, 'r2', ?, now(),
        (SELECT next_val FROM (SELECT COALESCE(MAX(display_order), 0) + 1 AS next_val FROM wish_images WHERE wish_id = ?) AS temp_table)
       )`,
        [id, r2Data.key, id],
      );

      res.status(201).json({
        id: result.insertId,
        filename: r2Data.key.split("/").pop(),
        url: r2Data.url,
        path: r2Data.key,
      });
    } catch (error) {
      if (error.code === "DUPLICATE_FILE") {
        return res.status(409).json({ error: error.message });
      }

      console.error("R2 Upload Error:", error);
      res.status(500).json({
        error: "Failed to upload image to Cloudflare R2.",
        details: error.message,
      });
    }
  },
);

router.post(
  "/:id/images/attach/",
  requireAuth,
  verifyAdmin,
  async (req, res) => {
    const { id } = req.params;
    const { imagePath } = req.body;

    if (!imagePath) {
      return res
        .status(400)
        .json({ error: "imagePath is required to attach an existing image" });
    }

    try {
      await dbPool.query(
        "INSERT INTO wish_images (wish_id, image_type, image_path, display_order) VALUES (?, 'r2', ?, 0)",
        [id, imagePath],
      );
      res.status(201).json({ message: "Image attached successfully" });
    } catch (error) {
      res.status(500).json({ error: "Failed to attach image" });
    }
  },
);

router.post("/:id/images/url", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;
  const { imagePath } = req.body;

  if (!imagePath) {
    return res
      .status(400)
      .json({ error: "External image URL (imagePath) is required" });
  }

  try {
    await dbPool.query(
      "INSERT INTO wish_images (wish_id, image_type, image_path, display_order) VALUES (?, 'url', ?, 0)",
      [id, imagePath],
    );
    res.status(201).json({ message: "External attached successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to attach external image" });
  }
});

router.delete(
  "/:id/images/:imageId",
  requireAuth,
  verifyAdmin,
  async (req, res) => {
    const { id, imageId } = req.params;

    try {
      const [rows] = await dbPool.query(
        "SELECT image_path FROM wish_images WHERE id = ? AND wish_id = ? AND image_type = 'r2'",
        [imageId, id],
      );

      if (rows.length > 0) {
        const path = rows[0].image_path;
        await deleteFromR2(path);
      }
      await dbPool.query("DELETE FROM wish_images WHERE id = ?", [imageId]);

      res.status(200).json({ message: "Image deleted from R2 and database." });
    } catch (error) {
      console.error("Error on deleting:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

router.delete("/:id/images/", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [images] = await dbPool.query(
      "SELECT image_path FROM wish_images WHERE wish_id = ? AND image_type = 'r2'",
      [id],
    );
    const keys = images.map((img) => img.image_path);
    if (keys.length > 0) {
      await deleteManyFromR2(keys);
    }
    await dbPool.query("DELETE FROM wish_images WHERE wish_id = ?", [id]);

    res
      .status(200)
      .json({ message: `Deleted all ${keys.length} images for wish ${id}` });
  } catch (error) {
    console.error("Database error deleting wishlist image:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
