export function detectMacLanIp(options = {}) {
  const interfaces = options.interfaces ?? {};
  const preferredInterface = options.preferredInterface ?? "";
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!Array.isArray(entries) || isIgnoredInterface(name)) continue;
    for (const entry of entries) {
      if (!isUsableIpv4(entry)) continue;
      candidates.push({
        address: entry.address,
        interfaceName: name,
        score: interfaceScore(name, preferredInterface),
      });
    }
  }

  candidates.sort((a, b) =>
    a.score - b.score || a.interfaceName.localeCompare(b.interfaceName)
  );
  return candidates[0] ?? null;
}

export function isUsableIpv4(entry) {
  if (!entry || entry.family !== "IPv4" || entry.internal) return false;
  const address = entry.address ?? "";
  return !(
    address.startsWith("127.") ||
    address.startsWith("169.254.") ||
    address === "0.0.0.0"
  );
}

function interfaceScore(name, preferredInterface) {
  if (preferredInterface && name === preferredInterface) return 0;
  if (name === "en0") return 10;
  if (name === "en1") return 11;
  if (name.startsWith("en")) return 20;
  return 50;
}

function isIgnoredInterface(name) {
  return /^(lo|awdl|llw|utun|bridge|vmnet|vboxnet|docker|gif|stf)/.test(name);
}
