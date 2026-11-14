/**
 * Master Admin Email & Whitelist authorization engine.
 * xhieupeo@gmail.com is configured as the master authorized account.
 */
export const PRIMARY_ADMIN_EMAIL = "xhieupeo@gmail.com";

export const BUILTIN_AUTHORIZED_EMAILS = [
  "xhieupeo@gmail.com",
  "tanbeongaoda@gmail.com",
];

export function isEmailAuthorized(email: string | null | undefined): boolean {
  if (!email) return false;
  const clean = email.trim().toLowerCase();

  // Builtin authorized emails are always accepted
  if (BUILTIN_AUTHORIZED_EMAILS.includes(clean)) {
    return true;
  }

  const rawWhitelist =
    process.env.NEXT_PUBLIC_ALLOWED_EMAILS ||
    process.env.ALLOWED_EMAILS ||
    BUILTIN_AUTHORIZED_EMAILS.join(",");

  const allowedList = rawWhitelist
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // If allow all users is explicitly enabled or list has wildcard "*"
  if (
    process.env.ALLOW_ALL_USERS === "true" ||
    process.env.NEXT_PUBLIC_ALLOW_ALL_USERS === "true" ||
    allowedList.includes("*")
  ) {
    return true;
  }

  // Check domain wildcards like @fpt.edu.vn or @gmail.com
  const matchesDomain = allowedList.some((entry) => entry.startsWith("@") && clean.endsWith(entry));
  if (matchesDomain) {
    return true;
  }

  // Strictly check against whitelist
  return allowedList.includes(clean);
}

export function getAllowedEmailsList(): string[] {
  const raw =
    process.env.NEXT_PUBLIC_ALLOWED_EMAILS ||
    process.env.ALLOWED_EMAILS ||
    BUILTIN_AUTHORIZED_EMAILS.join(",");

  if (raw.trim() === "*") return ["* (All)"];

  return Array.from(
    new Set([
      ...BUILTIN_AUTHORIZED_EMAILS,
      ...raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ])
  );
}
