import request from "supertest";
import app from "../server.js";

describe("Server", () => {
  describe("GET /health", () => {
    it("should return status ok", async () => {
      const response = await request(app).get("/health");

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: "ok" });
    });
  });
});
