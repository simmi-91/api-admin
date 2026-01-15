import { jest } from "@jest/globals";

jest.unstable_mockModule("../src/service/imageProvider.js", () => ({
  wishlistUpload: {
    single: jest.fn(() => (req, res, next) => {
      req.file = {
        originalname: "test.png",
        filename: "test.png",
        mimetype: "image/png",
        buffer: Buffer.from("fake-image-data"),
      };
      next();
    }),
  },
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
  deleteManyFromR2: jest.fn(),
  listAllImages: jest.fn(),
  createFullImageUrl: jest.fn((path, type) =>
    type === "r2" ? `${process.env.R2_PUBLIC_URL}/${path}` : path
  ),
}));

const imageProvider = await import("../src/service/imageProvider.js");
const { default: app } = await import("../server.js");
const { default: dbPool } = await import("../src/database.js");
const { getAdminToken, getNonAdminToken } = await import("./testAuth.js");
const { default: request } = await import("supertest");

let adminToken;
let nonAdminToken;

describe("Wishlist API", () => {
  beforeAll(async () => {
    adminToken = await getAdminToken();
    nonAdminToken = getNonAdminToken();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    try {
      await dbPool.query("SET FOREIGN_KEY_CHECKS = 0");
      await dbPool.query("TRUNCATE TABLE wish_images");
      await dbPool.query("TRUNCATE TABLE wishlist");
    } catch (error) {
      console.error(
        "Failed to truncate wishlist and wish images tables:",
        error.message
      );
      throw error;
    } finally {
      await dbPool.query("SET FOREIGN_KEY_CHECKS = 1");
    }
  });

  afterAll(async () => {
    await dbPool.end();
  });

  // --- Security Tests ---

  const secureRoutes = [
    { method: "get", url: "/wishlist" },
    { method: "post", url: "/wishlist" },
    { method: "put", url: "/wishlist/1" },
    { method: "delete", url: "/wishlist/1" },
  ];
  secureRoutes.forEach(({ method, url }) => {
    it(`[SECURITY] ${method.toUpperCase()} ${url} should return 401 if no token is provided`, async () => {
      const response = await request(app)[method](url);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Access token missing.");
    });
  });

  const adminRoutes = [
    { method: "post", url: "/wishlist", payload: { title: "Test" } },
    { method: "put", url: "/wishlist/1", payload: { title: "Test" } },
    { method: "delete", url: "/wishlist/1" },
  ];
  adminRoutes.forEach(({ method, url, payload }) => {
    it(`[SECURITY] ${method.toUpperCase()} ${url} should return 403 if token is for a non-admin user`, async () => {
      let req = request(app)[method](url).set("Authorization", nonAdminToken);
      if (payload) {
        req = req.send(payload);
      }
      const response = await req;
      expect(response.status).toBe(403);
      expect(response.body.error).toContain("not authorized");
    });
  });

  it("[SECURITY] GET /wishlist should return 200 with non-admin token (requireAuth only)", async () => {
    const response = await request(app)
      .get("/wishlist")
      .set("Authorization", nonAdminToken);
    expect(response.status).toBe(200);
  });

  // --- Method Tests ---

  describe("GET /wishlist", () => {
    it("should return empty array initially", async () => {
      const response = await request(app)
        .get("/wishlist")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it("should return items added to the database", async () => {
      const title = "Setup Item";
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");

      const sql = `
        INSERT INTO wishlist 
        (title, description, category, active, createdAt, updated) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      const values = [title, "Test Desc", 0, 1, now, now];

      await dbPool.query(sql, values);

      const response = await request(app)
        .get("/wishlist")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body.length).toBe(1);
    });
  });

  describe("POST /wishlist", () => {
    it("should create a new item and return the auto-increment ID (integer)", async () => {
      const newItem = {
        title: "Test Item",
        description: "Test description",
        category: 1,
        active: 1,
      };

      const response = await request(app)
        .post("/wishlist")
        .set("Authorization", adminToken)
        .send(newItem);

      expect(response.status).toBe(201);
      expect(response.body.title).toBe("Test Item");

      expect(response.body).toHaveProperty("id");
      expect(typeof response.body.id).toBe("number");
      expect(response.body.id).toBeGreaterThan(0);

      const [rows] = await dbPool.query("SELECT * FROM wishlist WHERE id = ?", [
        response.body.id,
      ]);
      expect(rows.length).toBe(1);
      expect(rows[0].title).toBe("Test Item");
    });

    it("should return 400 if title is missing", async () => {
      const response = await request(app)
        .post("/wishlist")
        .set("Authorization", adminToken)
        .send({ description: "No title" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Title is required");
    });

    it("should return 409 Conflict if title is a duplicate", async () => {
      const duplicateItem = {
        title: "Test Item",
        description: "Initial post",
      };

      await request(app)
        .post("/wishlist")
        .set("Authorization", adminToken)
        .send(duplicateItem);

      const response = await request(app)
        .post("/wishlist")
        .set("Authorization", adminToken)
        .send(duplicateItem);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        "A wishlist item with this title already exists."
      );
    });
  });

  describe("PUT /wishlist/:id", () => {
    it("should update an existing item", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Old Title", "Old Desc", 0, 0, now, now]
      );

      const response = await request(app)
        .put(`/wishlist/${insert.insertId}`)
        .set("Authorization", adminToken)
        .send({
          title: "New Title",
          description: "New Desc",
          category: 2,
          active: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.title).toBe("New Title");
      expect(response.body.description).toBe("New Desc");
      expect(response.body.category).toBe(2);
      expect(response.body.active).toBe(1);

      const [rows] = await dbPool.query(
        "SELECT title, description, category, active FROM wishlist WHERE id = ?",
        [insert.insertId]
      );
      expect(rows[0]).toMatchObject({
        title: "New Title",
        description: "New Desc",
        category: 2,
        active: 1,
      });
    });

    it("should return 400 when title is missing", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Keep Title", "Desc", 1, 1, now, now]
      );

      const response = await request(app)
        .put(`/wishlist/${insert.insertId}`)
        .set("Authorization", adminToken)
        .send({ description: "No title" });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Title is required");
    });

    it("should return 404 for non-existent id", async () => {
      const response = await request(app)
        .put("/wishlist/9999")
        .set("Authorization", adminToken)
        .send({ title: "Nothing" });

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Wishlist item not found.");
    });
  });

  describe("DELETE /wishlist/:id", () => {
    it("should delete an existing item", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Delete Me", "Desc", 0, 1, now, now]
      );

      const response = await request(app)
        .delete(`/wishlist/${insert.insertId}`)
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body.message).toBe("Wishlist item deleted");

      const [rows] = await dbPool.query("SELECT * FROM wishlist WHERE id = ?", [
        insert.insertId,
      ]);
      expect(rows.length).toBe(0);
    });
  });

  describe("GET /wishlist with images", () => {
    it("should include images ordered by display_order and build URLs", async () => {
      process.env.R2_PUBLIC_URL = "https://cdn.example.com";
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["With Images", "Desc", 0, 1, now, now]
      );
      await dbPool.query(
        `INSERT INTO wish_images (wish_id, image_type, image_path, display_order)
         VALUES (?, 'r2', ?, 2),
                (?, 'url', ?, 1)`,
        [insert.insertId, "r2/path.png", insert.insertId, "https://ext/img.jpg"]
      );

      const response = await request(app)
        .get("/wishlist")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      const item = response.body.find((i) => i.id === insert.insertId);
      expect(item.images).toHaveLength(2);
      expect(item.images[0].display_order).toBe(1);
      expect(item.images[0].url).toBe("https://ext/img.jpg");
      expect(item.images[1].url).toBe("https://cdn.example.com/r2/path.png");
    });
  });

  describe("Image routes", () => {
    it("should upload an image to R2 and store DB record", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Upload Target", "Desc", 0, 1, now, now]
      );
      imageProvider.uploadToR2.mockResolvedValue({
        key: "r2/uploaded.png",
        url: "https://cdn.example.com/r2/uploaded.png",
      });

      const response = await request(app)
        .post(`/wishlist/${insert.insertId}/images`)
        .set("Authorization", adminToken)
        .attach("image", Buffer.from("fake"), {
          filename: "photo.png",
          contentType: "image/png",
        });

      expect(response.status).toBe(201);
      expect(response.body.path).toBe("r2/uploaded.png");
      expect(imageProvider.uploadToR2).toHaveBeenCalled();

      const [rows] = await dbPool.query(
        "SELECT image_path, display_order FROM wish_images WHERE wish_id = ?",
        [insert.insertId]
      );
      expect(rows[0].image_path).toBe("r2/uploaded.png");
      expect(rows[0].display_order).toBe(1);
    });

    it("should return 409 when R2 reports duplicate file", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Dup Target", "Desc", 0, 1, now, now]
      );
      const duplicateErr = new Error("DUPLICATE_FILE");
      duplicateErr.code = "DUPLICATE_FILE";
      imageProvider.uploadToR2.mockRejectedValue(duplicateErr);

      const response = await request(app)
        .post(`/wishlist/${insert.insertId}/images`)
        .set("Authorization", adminToken)
        .attach("image", Buffer.from("fake"), {
          filename: "photo.png",
          contentType: "image/png",
        });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("DUPLICATE_FILE");
    });

    it("should delete all images for a wish and remove from R2", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Delete Images", "Desc", 0, 1, now, now]
      );
      await dbPool.query(
        `INSERT INTO wish_images (wish_id, image_type, image_path, display_order)
         VALUES (?, 'r2', ?, 1)`,
        [insert.insertId, "r2/some.png"]
      );

      const response = await request(app)
        .delete(`/wishlist/${insert.insertId}/images/`)
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(imageProvider.deleteManyFromR2).toHaveBeenCalledWith([
        "r2/some.png",
      ]);

      const [rows] = await dbPool.query(
        "SELECT * FROM wish_images WHERE wish_id = ?",
        [insert.insertId]
      );
      expect(rows.length).toBe(0);
    });

    it("should delete a single image and remove from R2", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Delete One Image", "Desc", 0, 1, now, now]
      );

      const [img] = await dbPool.query(
        `INSERT INTO wish_images (wish_id, image_type, image_path, display_order)
         VALUES (?, 'r2', ?, 1)`,
        [insert.insertId, "r2/one.png"]
      );

      imageProvider.deleteFromR2.mockResolvedValue();

      const response = await request(app)
        .delete(`/wishlist/${insert.insertId}/images/${img.insertId}`)
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(imageProvider.deleteFromR2).toHaveBeenCalledWith("r2/one.png");

      const [rows] = await dbPool.query(
        "SELECT * FROM wish_images WHERE id = ?",
        [img.insertId]
      );
      expect(rows.length).toBe(0);
    });

    it("should require imagePath when attaching existing or external images", async () => {
      const now = new Date().toISOString().slice(0, 19).replace("T", " ");
      const [insert] = await dbPool.query(
        `INSERT INTO wishlist (title, description, category, active, createdAt, updated)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ["Attach Target", "Desc", 0, 1, now, now]
      );

      const attachResponse = await request(app)
        .post(`/wishlist/${insert.insertId}/images/attach`)
        .set("Authorization", adminToken)
        .send({});
      expect(attachResponse.status).toBe(400);

      const urlResponse = await request(app)
        .post(`/wishlist/${insert.insertId}/images/url`)
        .set("Authorization", adminToken)
        .send({});
      expect(urlResponse.status).toBe(400);
    });

    it("should list gallery images from R2", async () => {
      imageProvider.listAllImages.mockResolvedValue([
        { key: "file1.png", url: "https://cdn/file1.png" },
      ]);

      const response = await request(app)
        .get("/wishlist/images/gallery")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body[0].key).toBe("file1.png");
    });
  });
});
