import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

export interface IngressSourceUrlPolicy {
  allowedHosts: string[];
  maxRedirects: number;
  timeoutMs: number;
}

export async function validateIngressSourceUrl(
  sourceUrl: string,
  policy: IngressSourceUrlPolicy,
) {
  try {
    let current = parseAllowedUrl(sourceUrl, policy.allowedHosts);
    const visited = new Set<string>();
    const resolutions: string[] = [];
    for (let redirectCount = 0; redirectCount <= policy.maxRedirects; redirectCount++) {
      const normalized = current.toString();
      if (visited.has(normalized)) return failure("redirect_loop");
      visited.add(normalized);
      const addresses = await resolvePublicAddresses(current.hostname);
      resolutions.push(`${current.hostname}:${addresses.map((item) =>
        `${item.family}:${item.address}`
      ).sort().join(",")}`);
      const head = await pinnedHead(current, addresses[0]!, policy.timeoutMs);
      if (head.statusCode >= 300 && head.statusCode < 400) {
        if (!head.location || redirectCount === policy.maxRedirects) {
          return failure("redirect_not_allowed");
        }
        current = parseAllowedUrl(new URL(head.location, current).toString(), policy.allowedHosts);
        continue;
      }
      if (head.statusCode < 200 || head.statusCode >= 300) {
        return failure("source_preflight_failed");
      }
      return {
        ok: true as const,
        finalUrl: current.toString(),
        sourceUrlHash: sha256(sourceUrl),
        finalUrlHash: sha256(current.toString()),
        resolutionHash: sha256(resolutions.sort().join("|")),
        validatedAt: new Date().toISOString(),
        redirectCount,
      };
    }
    return failure("redirect_not_allowed");
  } catch (error) {
    return failure(policyError(error));
  }
}

function parseAllowedUrl(value: string, allowedHosts: string[]) {
  if (Buffer.byteLength(value) > 2_048) throw new Error("url_too_long");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("invalid_url");
  }
  const host = url.hostname.toLowerCase();
  if (isIP(host) !== 0 || host === "localhost" || host.endsWith(".local")) {
    throw new Error("literal_or_local_host");
  }
  if (!allowedHosts.some((allowed) =>
    host === allowed || host.endsWith(`.${allowed}`)
  )) throw new Error("host_not_allowed");
  return url;
}

async function resolvePublicAddresses(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((item) =>
    nonPublicAddresses.check(item.address, item.family === 6 ? "ipv6" : "ipv4")
  )) throw new Error("non_public_dns_answer");
  return addresses;
}

function pinnedHead(
  url: URL,
  target: { address: string; family: number },
  timeoutMs: number,
) {
  return new Promise<{ statusCode: number; location?: string }>((resolve, reject) => {
    const request = httpsRequest(url, {
      method: "HEAD",
      servername: url.hostname,
      headers: {
        accept: "*/*",
        "user-agent": "ai-phone-ingress-preflight/1.0",
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, target.address, target.family);
      },
    }, (response) => {
      response.resume();
      resolve({
        statusCode: response.statusCode ?? 0,
        ...(typeof response.headers.location === "string"
          ? { location: response.headers.location }
          : {}),
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error("preflight_timeout")));
    request.once("error", reject);
    request.end();
  });
}

function failure(errorClass: string) {
  return { ok: false as const, errorClass: errorClass.slice(0, 80) };
}

function policyError(error: unknown) {
  return error instanceof Error ? error.message : "source_policy_error";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const nonPublicAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) nonPublicAddresses.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["64:ff9b::", 96],
  ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 32],
  ["2001:2::", 48], ["2001:db8::", 32], ["2002::", 16],
  ["fc00::", 7], ["fe80::", 10],
  ["ff00::", 8],
] as const) nonPublicAddresses.addSubnet(network, prefix, "ipv6");
