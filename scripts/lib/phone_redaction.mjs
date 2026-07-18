export function redactPhoneNumbers(value, targetPhone = "") {
  let redacted = String(value);
  for (const variant of targetVariants(targetPhone)) {
    redacted = redacted.split(variant).join("[REDACTED_TARGET]");
  }
  return redacted
    .replace(/\+[1-9]\d{7,14}/g, "[REDACTED_E164]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[REDACTED_PHONE]");
}

function targetVariants(targetPhone) {
  if (!targetPhone) return [];
  return targetPhone.startsWith("+86")
    ? [targetPhone, targetPhone.slice(3)]
    : [targetPhone];
}
