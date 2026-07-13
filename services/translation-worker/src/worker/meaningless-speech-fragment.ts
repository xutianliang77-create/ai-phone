export function isMeaninglessSpeechFragment(text: string) {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[\s,，.。!！?？;；:：、~～]+/gu, "");
  if (!normalized) return true;
  return chineseFillers.has(normalized) || englishFillers.has(normalized);
}

const chineseFillers = new Set([
  "嗯",
  "嗯嗯",
  "哦",
  "噢",
  "啊",
  "呃",
  "额",
  "唔",
  "哎",
  "诶",
]);

const englishFillers = new Set([
  "ah",
  "er",
  "hmm",
  "mhm",
  "uh",
  "uhh",
  "um",
  "umm",
]);
