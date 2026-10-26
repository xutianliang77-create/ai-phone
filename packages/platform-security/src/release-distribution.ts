import { isIP } from "node:net";

export type ReleaseDistributionChannel = "restricted_instance" | "app_store";

export function releaseDistribution(value: string | undefined) {
  const channel = value?.trim() || "restricted_instance";
  return {
    channel,
    formal: channel === "app_store",
    issues: ["restricted_instance", "app_store"].includes(channel)
      ? [] : ["invalid DOMESTIC_RELEASE_DISTRIBUTION_CHANNEL"],
  };
}

export function releaseDeferredCapabilities(profile: string, channel: string) {
  if (profile !== "core_translation") return [];
  const deferred = ["livekit_sip", "agent", "egress", "payment"];
  return channel === "app_store" ? [...deferred, "call_link", "web_guest"] : [
    ...deferred, "sms", "diagnostics_alerting", "release_materials",
  ];
}

/** Syntax-only edge validation. No DNS or HTTP/model requests are performed. */
export function isPublicReleaseEndpoint(value: string | undefined, protocols: readonly string[]) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    if (!protocols.includes(url.protocol) || url.username || url.password || url.search || url.hash) return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (isIP(host) === 4) {
      const [a, b, c] = host.split(".").map(Number);
      return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113));
    }
    if (isIP(host) === 6) return /^[23]/.test(host) && !host.startsWith("2001:db8:");
    return host.length <= 253 && host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(host) &&
      !/(^|\.)(localhost|local|test|invalid|example)(\.|$)/.test(host) &&
      !/(^|\.)(internal|home|lan)$/.test(host);
  } catch { return false; }
}

export function redactReleaseEndpoint(value: string | undefined) {
  if (!value) return value;
  try {
    const url = new URL(value);
    if (!url.username && !url.password && !url.search && !url.hash) return value;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return "invalid-url"; }
}
