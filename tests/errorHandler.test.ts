import { jest } from "@jest/globals";
import express, { type RequestHandler } from "express";
import multer from "multer";
import request from "supertest";

import { errorHandler } from "../src/middleware/errorHandler.js";
import { HttpError } from "../src/utils/errors.js";

const dbError = (code: string) =>
  Object.assign(new Error(`Duplicate entry 'x' for key 'secret_column'`), {
    code,
    sqlMessage: "secret sql details",
  });

// Builds an app where GET /fail runs `handler`, with errorHandler(messages) mounted after it
const appWith = (handler: RequestHandler, messages = {}) => {
  const app = express();
  app.use(express.json());
  app.get("/fail", handler);
  app.post("/json", (req, res) => {
    res.json(req.body);
  });
  app.use(errorHandler(messages));
  return app;
};

const throwing = (err: Error): RequestHandler => async () => {
  throw err;
};

describe("errorHandler", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends status and message from HttpError", async () => {
    const response = await request(appWith(throwing(new HttpError(501, "Not implemented")))).get("/fail");

    expect(response.status).toBe(501);
    expect(response.body).toEqual({ error: "Not implemented" });
  });

  it("maps known MySQL error codes to a default response without leaking SQL details", async () => {
    const response = await request(appWith(throwing(dbError("ER_DUP_ENTRY")))).get("/fail");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Already exists" });
  });

  it("uses the router's own message over the default", async () => {
    const app = appWith(throwing(dbError("ER_DUP_ENTRY")), {
      ER_DUP_ENTRY: [409, "A wishlist item with this title already exists."],
    });

    const response = await request(app).get("/fail");

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "A wishlist item with this title already exists." });
  });

  it("sends 413 for multer's file size limit and 400 for other multer errors", async () => {
    const tooLarge = await request(appWith(throwing(new multer.MulterError("LIMIT_FILE_SIZE")))).get("/fail");
    const unexpected = await request(
      appWith(throwing(new multer.MulterError("LIMIT_UNEXPECTED_FILE", "image")))
    ).get("/fail");

    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body).toEqual({ error: "File too large. Maximum size is 5MB." });
    expect(unexpected.status).toBe(400);
  });

  it("sends 400 JSON for an invalid JSON body", async () => {
    const response = await request(appWith(throwing(new Error("unused"))))
      .post("/json")
      .set("Content-Type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error");
  });

  it("logs unknown errors and sends a generic 500", async () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3306");

    const response = await request(appWith(throwing(err))).get("/fail");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Internal error" });
    expect(console.error).toHaveBeenCalledWith(err);
  });

  it("leaves the response alone if headers were already sent", async () => {
    const app = appWith(async (req, res) => {
      res.status(200).json({ ok: true });
      throw new Error("after response");
    });

    const response = await request(app).get("/fail");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });
});
