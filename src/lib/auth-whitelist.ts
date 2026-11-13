/**
 * Helper to check whether an email address is authorized to access the site.
 * Reads from NEXT_PUBLIC_ALLOWED_EMAILS (browser) and ALLOWED_EMAILS (server).
 * Format: comma-separated list of emails, e.g. "user1@fpt.edu.vn,user2@gmail.com"
 */
export function isEmailAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;

  const rawWhitelist =
    process.env.NEXT_PUBLIC_ALLOWED_EMAILS ||
    process.env.ALLOWED_EMAILS ||
    "";

  // If no whitelist is specified, all authenticated users are permitted
  const trimmed = rawWhitelist.trim();
  if (!trimmed || trimmed === "*") {
    return true;
  }

  const allowedList = trimmed
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowedList.length === 0) {
    return true;
  }

  return allowedList.includes(email.trim().toLowerCase());
}

export function getAllowedEmailsList(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_ALLOWED_EMAILS ||
    process.env.ALLOWED_EMAILS ||
    "";
  if (!raw.trim() || raw.trim() === "*") return [];
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
