export function cleanCallTranscript(text: string | undefined) {
  const collapsed = text?.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const compact = collapsed
    .toLowerCase()
    .replace(/[\s,，.。!！?？;；:：、\-_\/]+/g, "")
    .replace(/(?:<|\[|\()(?:sil|noise|blank|unk)(?:>|\]|\))/g, "");
  return compact.length === 0 ? null : collapsed;
}
