const textPrivacyFields = new Set(["text", "transcript", "sourceText", "translatedText", "receivedText"]);

export function forbiddenTextFields(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      forbiddenTextFields(item, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const own = textPrivacyFields.has(key) ? [path] : [];
    return [...own, ...forbiddenTextFields(child, path)];
  });
}

export function textPrivacyIssuesForJsonLines(content, markerPattern) {
  return content.split(/\r?\n/).flatMap((line) => {
    const marker = line.match(markerPattern)?.[0];
    if (!marker) return [];
    const jsonStart = line.indexOf("{", line.indexOf(marker) + marker.length);
    if (jsonStart === -1) return [];
    const payload = safeJsonParse(line.slice(jsonStart));
    return forbiddenTextFields(payload).map((field) =>
      `${marker}: forbidden field ${field}`);
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
