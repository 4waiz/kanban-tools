import "server-only";
import dns from "node:dns/promises";
import { isPrivateOrReservedIp } from "./security";

/**
 * DNS-resolving SSRF guard.
 *
 * The structural URL check (validatePublicUrl) blocks obvious private hostnames,
 * but `http://internal.evil.com` can still resolve to 10.0.0.5. Before the link
 * downloader connects, we resolve the host and reject if ANY resolved address is
 * private/reserved. This also catches the easy DNS-rebinding case.
 *
 * Residual risk (documented): a TOCTOU rebind between this check and the actual
 * connection is still theoretically possible. For a hostile multi-tenant
 * environment, additionally pin the connection to the validated IP or route all
 * egress through an allowlisting proxy. That's an infra control, noted in README.
 */

export interface SsrfCheck {
  ok: boolean;
  reason?: string;
  addresses?: string[];
}

export async function assertHostResolvesPublic(hostname: string): Promise<SsrfCheck> {
  const host = hostname.trim().toLowerCase();

  // If the host is already an IP literal, classify it directly.
  if (isIpLiteral(host)) {
    if (isPrivateOrReservedIp(host)) {
      return { ok: false, reason: "Address resolves to a private network." };
    }
    return { ok: true, addresses: [host] };
  }

  let addresses: string[];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    return { ok: false, reason: "Could not resolve that host." };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "Host did not resolve to any address." };
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr)) {
      return {
        ok: false,
        reason: "Host resolves to an internal or reserved address.",
      };
    }
  }

  return { ok: true, addresses };
}

function isIpLiteral(host: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // crude IPv6 literal detection (contains a colon)
  if (host.includes(":")) return true;
  return false;
}
