// Errors from mysql2 and our own services carry an optional `code` (e.g. "ER_DUP_ENTRY", "DUPLICATE_FILE")
export type AppError = Error & { code?: string; sqlMessage?: string };

export const toAppError = (error: unknown): AppError =>
  error instanceof Error ? error : new Error(String(error));
