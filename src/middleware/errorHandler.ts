import type { NextFunction, Request, Response } from "express";
import { HttpError, type AppError } from "../utils/errors.js";

export type ErrorMessages = Record<string, [status: number, message: string]>;

const DEFAULT_MESSAGES: ErrorMessages = {
    ER_DUP_ENTRY: [409, "Already exists"],
    ER_ROW_IS_REFERENCED_2: [409, "In use by other records"],
    ER_NO_REFERENCED_ROW_2: [400, "Referenced record does not exist"],
    ER_CHECK_CONSTRAINT_VIOLATED: [400, "Missing required fields"],
    LIMIT_FILE_SIZE: [413, "File too large. Maximum size is 5MB."],
};

export const errorHandler =
    (messages: ErrorMessages = {}) =>
    (err: AppError, req: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) {
            return next(err);
        }

        if (err instanceof HttpError) {
            return res.status(err.status).json({ error: err.message });
        }

        const known = err.code ? (messages[err.code] ?? DEFAULT_MESSAGES[err.code]) : undefined;
        if (known) {
            const [status, message] = known;
            return res.status(status).json({ error: message });
        }

        if (err.name === "MulterError") {
            return res.status(400).json({ error: err.message });
        }

        if (err.status && err.status < 500) {
            return res.status(err.status).json({ error: err.message });
        }

        console.error(err);
        return res.status(500).json({ error: "Internal error" });
    };
