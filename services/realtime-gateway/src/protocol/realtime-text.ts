const markerPattern =
  /(?:<|\[|\()(?:\|?\s*)?(?:sil|noise|blank|unk|nospeech|no[\s_-]*speech|inaudible)(?:\s*\|?)?(?:>|\]|\))/gi;
const ignorableText = new Set([
  "sil",
  "noise",
  "blank",
  "unk",
  "nospeech",
  "nonspeech",
  "inaudible",
]);
const promptLeakMarkerPattern =
  /\b(?:verbatim\s+asr|preserve\s+mixed\s+chinese[-\s]?english|use\s+exact\s+spellings\s+when\s+acoustically\s+plausible|prefer\s+these\s+protected\s+terms|avoid\s+common\s+confusions|hy-mt2\s+not\s+m\s*t2)\b/i;
const protectedTermPattern =
  /\b(?:iphone\s+14|a-120|fireredasr2|hy-mt2|voxcpm2|nemotron|whisper)\b/gi;

export function cleanRealtimeText(text: string | undefined | null) {
  const withoutPromptLeak = stripPromptLeak(text);
  const stripped = withoutPromptLeak?.replace(markerPattern, " ");
  const collapsed = stripped?.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const compact = collapsed
    .toLowerCase()
    .replace(/[\s,，.。!！?？;；:：、\-_\/|]+/g, "");
  return ignorableText.has(compact) ? null : collapsed;
}

function stripPromptLeak(text: string | undefined | null) {
  if (!text) return text;
  const match = promptLeakMarkerPattern.exec(text);
  if (!match) return text;
  const beforeMarker = text.slice(0, match.index).trim();
  if (!beforeMarker || isLikelyProtectedTermPromptPrefix(beforeMarker)) return "";
  return beforeMarker;
}

function isLikelyProtectedTermPromptPrefix(text: string) {
  const matches = text.match(protectedTermPattern) ?? [];
  return matches.length >= 3;
}
