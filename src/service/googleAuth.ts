import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { toAppError } from "../utils/errors.js";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

export async function verifyGoogleToken(token: string): Promise<TokenPayload | null> {
  if (!GOOGLE_CLIENT_ID) {
    console.error("GOOGLE_CLIENT_ID is not set in environment variables.");
    return null;
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    return payload ?? null;
  } catch (error) {
    console.error("Google Token Verification Failed:", toAppError(error).message);
    return null;
  }
}
