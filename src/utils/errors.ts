export type AppError = Error & { code?: string; sqlMessage?: string; status?: number };

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const toAppError = (error: unknown): AppError =>
  error instanceof Error ? error : new Error(String(error));
