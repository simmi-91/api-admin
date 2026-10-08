import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export interface AuthUser extends JwtPayload {
  id: number;
  googleId?: string;
  email: string;
  isAdmin: boolean;
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Access token missing." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET ?? "");
    req.user = decoded as AuthUser;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
};

export const verifyAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (req.user && req.user.isAdmin) {
    return next();
  } else {
    return res
      .status(403)
      .json({ error: "You are not authorized to perform this operation" });
  }
};
