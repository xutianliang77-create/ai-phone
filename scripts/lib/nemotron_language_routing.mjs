export function languagePromptForText(text) {
  const value = String(text ?? "");
  const hasChinese = /[\u4e00-\u9fff]/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  if (hasChinese && hasLatin) return "auto";
  if (hasChinese) return "zh-CN";
  if (hasLatin) return "en-US";
  return "auto";
}

export function nextTurnPrompt(text, policy = "alternate") {
  const prompt = languagePromptForText(text);
  if (String(policy).toLowerCase() === "sticky") return prompt;
  if (prompt === "zh-CN") return "en-US";
  if (prompt === "en-US") return "zh-CN";
  return "auto";
}
