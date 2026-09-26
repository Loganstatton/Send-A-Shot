import { ApiError } from "./api-client";

// Sprint requirement: "No raw backend/API validation errors should ever
// be displayed directly to users." class-validator's raw messages (e.g.
// "dateOfBirth must be a valid ISO 8601 date string", "property dob
// should not exist") are useful in logs, never in the UI.

const CODE_MESSAGES: Record<string, string> = {
  // Auth
  INVALID_CREDENTIALS: "That email or password isn't right.",
  ACCOUNT_EXISTS: "An account with that email or username already exists.",
  ACCOUNT_NOT_ACTIVE: "This account isn't active. Contact support for help.",
  AGE_RESTRICTED: "You must meet the minimum age requirement to register.",
  JURISDICTION_RESTRICTED: "This isn't available in your state yet.",
  INVALID_REFRESH_TOKEN: "Your session expired — please sign in again.",
  NO_REFRESH_TOKEN: "Your session expired — please sign in again.",
  UNAUTHENTICATED: "Please sign in to continue.",
  INVALID_TOKEN: "Your session expired — please sign in again.",

  // Wallet / games
  INSUFFICIENT_BALANCE: "You don't have enough balance for that.",
  IDEMPOTENCY_KEY_REQUIRED: "Something went wrong — please try again.",
  WALLET_NOT_FOUND: "We couldn't find that wallet. Please refresh and try again.",

  // Promotions
  ALREADY_CLAIMED: "You've already claimed this — check back later.",
  CLAIM_LIMIT_REACHED: "You've reached the claim limit for this promotion.",

  // Feature gating
  FEATURE_DISABLED: "This feature isn't available yet.",
  JURISDICTION_UNKNOWN: "We couldn't confirm your location for this action.",

  // Generic
  USER_NOT_FOUND: "We couldn't find that account.",
  GAME_NOT_FOUND: "That game isn't available right now.",
  VALIDATION_ERROR: "Please check your information and try again.",
};

const GENERIC_FALLBACK = "Something went wrong. Please try again.";

/** Heuristics for raw class-validator/NestJS messages that must never reach the UI verbatim. */
function looksLikeRawValidationMessage(message: string): boolean {
  return (
    /property .* should not exist/i.test(message) ||
    /must be a valid ISO 8601/i.test(message) ||
    /must be (longer|shorter) than/i.test(message) ||
    /must be an email/i.test(message) ||
    /should not be empty/i.test(message) ||
    /must be a string/i.test(message) ||
    /must be a number/i.test(message)
  );
}

/**
 * The single place API errors get turned into UI copy. Always call this
 * instead of reading err.message directly in a component.
 */
export function friendlyErrorMessage(err: unknown, fallback: string = GENERIC_FALLBACK): string {
  if (err instanceof ApiError) {
    const mapped = CODE_MESSAGES[err.code];
    if (mapped) return mapped;

    if (looksLikeRawValidationMessage(err.message)) {
      // eslint-disable-next-line no-console
      console.error(`[api] unmapped validation error (code=${err.code}):`, err.message);
      return "Please check your information and try again.";
    }

    // Codes we don't have friendly copy for yet: the backend's own
    // message is still human-written prose (not raw validator output),
    // so it's reasonable to show as-is, but log it so it can be added
    // to CODE_MESSAGES above.
    if (err.message && err.message !== "Request failed") {
      // eslint-disable-next-line no-console
      console.warn(`[api] unmapped error code "${err.code}", showing raw message:`, err.message);
      return err.message;
    }
  }
  return fallback;
}
