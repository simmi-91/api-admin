import request from "supertest";
import app from "../server.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

export async function getAdminToken() {
  const response = await request(app)
    .post("/auth/login")
    .send({ token: "LOCAL_TEST" });

  if (response.status !== 200) {
    throw new Error(
      `Failed to get Admin token (Status ${response.status}): ${response.body.error}`
    );
  }
  return `Bearer ${response.body.token}`;
}

export function getNonAdminToken() {
  const nonAdminPayload = {
    id: 999,
    email: "nonadmin@test.com",
    isAdmin: false,
  };

  const token = jwt.sign(nonAdminPayload, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
  return `Bearer ${token}`;
}
