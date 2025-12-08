import request from "supertest";

import app from "../server.js";
import dbPool from "../src/database.js";

import { getAdminToken, getNonAdminToken } from "./testAuth.js";

let adminToken;
let nonAdminToken;

describe("Wishlist API", () => {
  beforeAll(async () => {
    adminToken = await getAdminToken();
    nonAdminToken = getNonAdminToken();

    // Clear data before test
    try {
      await dbPool.query("TRUNCATE TABLE wishlist");
    } catch (error) {
      console.error("Failed to truncate wishlist table:", error.message);
      throw error;
    }
  });

  afterAll(async () => {
    await dbPool.end();
  });

  // --- Security Tests ---

  const secureRoutes = [
    { method: "get", url: "/api/wishlist" },
    { method: "post", url: "/api/wishlist" },
    { method: "put", url: "/api/wishlist/1" },
    { method: "delete", url: "/api/wishlist/1" },
  ];
  secureRoutes.forEach(({ method, url }) => {
    it(`[SECURITY] ${method.toUpperCase()} ${url} should return 401 if no token is provided`, async () => {
      const response = await request(app)[method](url);
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Access token missing.");
    });
  });

  const adminRoutes = [
    { method: "post", url: "/api/wishlist", payload: { title: "Test" } },
    { method: "put", url: "/api/wishlist/1", payload: { title: "Test" } },
    { method: "delete", url: "/api/wishlist/1" },
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

  it("[SECURITY] GET /api/wishlist should return 200 with non-admin token (requireAuth only)", async () => {
    const response = await request(app)
      .get("/api/wishlist")
      .set("Authorization", nonAdminToken);
    expect(response.status).toBe(200);
  });

  // --- Method Tests ---

  describe("GET /api/wishlist", () => {
    it("should return empty array initially", async () => {
      const response = await request(app)
        .get("/api/wishlist")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
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
        .get("/api/wishlist")
        .set("Authorization", adminToken);

      expect(response.status).toBe(200);
      expect(response.body.items.length).toBe(1);
    });
  });

  describe("POST /api/wishlist", () => {
    it("should create a new item and return the auto-increment ID (integer)", async () => {
      const newItem = {
        title: "Test Item",
        description: "Test description",
        category: 1,
        active: 1,
      };

      const response = await request(app)
        .post("/api/wishlist")
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
        .post("/api/wishlist")
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

      await request(app).post("/api/wishlist").send(duplicateItem);

      const response = await request(app)
        .post("/api/wishlist")
        .set("Authorization", adminToken)
        .send(duplicateItem);

      expect(response.status).toBe(409);
      expect(response.body.error).toBe(
        "A wishlist item with this title already exists."
      );
    });
  });
});
