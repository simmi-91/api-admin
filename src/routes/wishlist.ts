import express from "express";
import dbPool from "../database.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";
import { errorHandler } from "../middleware/errorHandler.js";
import {
  wishlistUpload,
  listAllImages,
  uploadToR2,
  deleteFromR2,
  deleteManyFromR2,
  createFullImageUrl,
  type ImageType,
} from "../service/imageProvider.js";

interface WishRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  category: number;
  active: number;
  createdAt: Date;
  updated: Date;
}

interface WishWithImageRow extends WishRow {
  image_id: number | null;
  image_path: string | null;
  image_type: ImageType | null;
  display_order: number | null;
}

// Columns are nullable in the schema, but this API always sets them
interface WishImageRow extends RowDataPacket {
  id: number;
  wish_id: number;
  image_type: ImageType;
  image_path: string;
  display_order: number;
  created_at: Date;
}

interface WishImage {
  id: number;
  path: string;
  display_order: number;
  image_type: ImageType;
  url: string;
}

type WishWithImages = Omit<WishWithImageRow, "image_id" | "image_path" | "image_type" | "display_order"> & {
  images: WishImage[];
};

const WISH_WITH_IMAGES_SELECT = `
  SELECT
    w.*,
    i.id AS image_id,
    i.image_path,
    i.image_type,
    i.display_order
  FROM wishlist w
  LEFT JOIN wish_images i ON w.id = i.wish_id
`;

const groupWishesWithImages = (rows: WishWithImageRow[]) => {
  const wishlistMap = new Map<number, WishWithImages>();
  rows.forEach((row) => {
    let wishWithImages = wishlistMap.get(row.id);
    if (!wishWithImages) {
      const { image_id, image_path, image_type, display_order, ...wish } = row;
      wishWithImages = { ...wish, images: [] };
      wishlistMap.set(row.id, wishWithImages);
    }

    if (row.image_id) {
      wishWithImages.images.push({
        id: row.image_id,
        path: row.image_path!,
        display_order: row.display_order!,
        image_type: row.image_type!,
        url: createFullImageUrl(row.image_path!, row.image_type!),
      });
    }
  });
  return [...wishlistMap.values()];
};

const router = express.Router();

// Resource - WISHLIST
router.get("/active", async (req, res) => {
  const [rows] = await dbPool.query<WishWithImageRow[]>(`
    ${WISH_WITH_IMAGES_SELECT}
    WHERE w.active=1
    ORDER BY w.createdAt DESC, i.display_order ASC
  `);

  res.json(groupWishesWithImages(rows));
});

router.get("/", requireAuth, async (req, res) => {
  const [rows] = await dbPool.query<WishWithImageRow[]>(`
    ${WISH_WITH_IMAGES_SELECT}
    ORDER BY w.createdAt DESC, i.display_order ASC
  `);

  res.json(groupWishesWithImages(rows));
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

  // Duplicate title -> ER_DUP_ENTRY
  const [result] = await dbPool.query<ResultSetHeader>(sql, values);

  const newItem = {
    id: result.insertId,
    title: itemTitle,
    description: itemDescription,
    category: itemCategory,
    active: itemActive,
    createdAt: now,
    updated: now,
  };

  res.status(201).json(newItem);
});

// Resource - GALLERY
router.get("/images/gallery", requireAuth, async (req, res) => {
  const images = await listAllImages();
  res.json(images);
});

router.delete(
  "/images/gallery/:imagePath",
  requireAuth,
  verifyAdmin,
  async (req, res) => {
    const { imagePath } = req.params as { imagePath: string };

    if (!imagePath) {
      return res
        .status(400)
        .json({ error: "imagePath is required to deltete an existing image" });
    }

    const [rows] = await dbPool.query<WishImageRow[]>(
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
  },
);

// Resource - SINGLE WISH
router.put("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const { title, description, category, active } = req.body;

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const itemTitle = title;
  const itemDescription = description || null;
  const itemCategory = category || 0;
  const itemActive = active || 0;

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

  const [result] = await dbPool.query<ResultSetHeader>(sql, values);
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
});

router.delete("/:id", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  await dbPool.query("DELETE FROM wishlist WHERE id = ?", [id]);

  res.status(200).json({ message: "Wishlist item deleted" });
});

// Resource - IMAGES CONNECTED TO WISHES
router.get("/:id/images", requireAuth, async (req, res) => {
  const { id } = req.params;

  const [rows] = await dbPool.query<WishImageRow[]>(
    "SELECT * FROM wish_images WHERE wish_id = ? ORDER BY wish_id ASC, display_order ASC",
    [id],
  );

  res.json(rows);
});

router.post(
  "/:id/images",
  requireAuth,
  verifyAdmin,
  wishlistUpload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const { id } = req.params;
    const { filename } = req.body;
    const customName = filename || "";

    const r2Data = await uploadToR2(file, customName);

    const [result] = await dbPool.query<ResultSetHeader>(
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

    await dbPool.query(
      "INSERT INTO wish_images (wish_id, image_type, image_path, display_order) VALUES (?, 'r2', ?, 0)",
      [id, imagePath],
    );
    res.status(201).json({ message: "Image attached successfully" });
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

  await dbPool.query(
    "INSERT INTO wish_images (wish_id, image_type, image_path, display_order) VALUES (?, 'url', ?, 0)",
    [id, imagePath],
  );
  res.status(201).json({ message: "External attached successfully" });
});

router.delete(
  "/:id/images/:imageId",
  requireAuth,
  verifyAdmin,
  async (req, res) => {
    const { id, imageId } = req.params;

    const [rows] = await dbPool.query<WishImageRow[]>(
      "SELECT image_path FROM wish_images WHERE id = ? AND wish_id = ? AND image_type = 'r2'",
      [imageId, id],
    );

    if (rows.length > 0) {
      const path = rows[0].image_path;
      await deleteFromR2(path);
    }
    await dbPool.query("DELETE FROM wish_images WHERE id = ?", [imageId]);

    res.status(200).json({ message: "Image deleted from R2 and database." });
  },
);

router.delete("/:id/images/", requireAuth, verifyAdmin, async (req, res) => {
  const { id } = req.params;

  const [images] = await dbPool.query<WishImageRow[]>(
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
});

// Error handler
router.use(
  errorHandler({
    ER_DUP_ENTRY: [409, "A wishlist item with this title already exists."],
    ER_NO_REFERENCED_ROW_2: [400, "Wishlist item does not exist."],
  }),
);

export default router;
