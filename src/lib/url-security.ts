/**
 * Validates that a user-supplied or HTML-extracted URL targets a public HTTP(S) host
 * and is not attempting Server-Side Request Forgery (SSRF) against localhost, private networks,
 * or cloud metadata endpoints (e.g. 169.254.169.254).
 */
export function assertSafePublicUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL format.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs are allowed.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs containing embedded credentials are not allowed.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    throw new Error("URL hostname is missing.");
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal"
  ) {
    throw new Error("Requests to local or internal hostnames are blocked.");
  }

  // Block private/loopback/link-local IPv4 literals
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    const isBlockedIpv4 =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);

    if (isBlockedIpv4) {
      throw new Error("Requests to private or link-local IP addresses are blocked.");
    }
  }

  // Block numeric/hex single-integer IPv4 obfuscation (e.g. http://2130706433 or http://0x7f000001)
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    throw new Error("Numeric or hex IP host literals are blocked.");
  }

  // Block loopback / unique-local / link-local IPv6 literals
  if (host.includes(":")) {
    const normalized = host.toLowerCase();
    if (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:169.254.") ||
      normalized.startsWith("::ffff:192.168.")
    ) {
      throw new Error("Requests to private or loopback IPv6 addresses are blocked.");
    }
  }

  return parsed;
}

