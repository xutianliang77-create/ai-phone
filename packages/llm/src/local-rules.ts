export interface LocalRuleResult {
  text: string;
  operations: string[];
  protectedTermsKept: string[];
  warnings: string[];
}

const defaultProtectedTerms = [
  "同传",
  "同声传译",
  "字幕",
  "端侧",
  "端侧 ASR",
  "在线模式",
  "断句",
  "语义组句",
  "会议纪要",
  "自动识别语言",
  "自动反向",
  "Qwen3 ASR",
  "FireRedASR2",
  "Hy-MT2",
  "VoxCPM2",
  "筑基丹",
  "灵脉之心",
  "命元丹",
  "雷劫",
  "雷劫功法",
  "雷灵根",
  "灵石",
  "道友",
  "洞府",
  "化形",
  "苟到化形",
  "A-120",
  "iPhone 14",
];

export function defaultAsrProtectedTerms() {
  return [...defaultProtectedTerms];
}

export function applyAsrLocalRules(
  rawText: string,
  protectedTerms: string[] = defaultProtectedTerms,
): LocalRuleResult {
  let text = cleanSilenceMarkers(rawText);
  const operations: string[] = [];
  const warnings: string[] = [];

  const replacements = termReplacements(protectedTerms);
  for (const [pattern, replacement, operation] of replacements) {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      text = next;
      operations.push(operation);
    }
  }

  const cleaned = cleanDisfluencies(text);
  if (cleaned !== text) {
    text = cleaned;
    operations.push("disfluency_cleanup");
  }

  text = text.replace(/\s+/g, " ").trim();
  const protectedTermsKept = protectedTerms.filter((term) =>
    term && text.toLowerCase().includes(term.toLowerCase()),
  );
  return { text, operations: [...new Set(operations)], protectedTermsKept, warnings };
}

function cleanDisfluencies(value: string) {
  return value
    .replace(/([，,。.!！？?；;：:、\s]|^)(嗯+|呃+|啊+|呐+|哎+|哎呀|那个|这个)(?=([，,。.!！？?；;：:、\s]|$))/g, "$1")
    .replace(/(嗯+|呃+|啊+|呐+)(?=([。.!！？?；;：:]|$))/g, "")
    .replace(/\b(um+|uh+|er+|ah+)\b[,.!?;:]?\s*/gi, "")
    .replace(/([我你他她它])\1+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/(我还|我也|我就|我只|你还|你也|你就|他还|他也|他就)\1+(?=[\u4e00-\u9fff])/g, "$1")
    .replace(/读读(?=出来|一遍|一下)/g, "读")
    .replace(/说说(?=出来|清楚|一下)/g, "说")
    .replace(/([，,。.!！？?；;：:、])\s*([，,。.!！？?；;：:、])+/g, "$1")
    .replace(/^\s*[，,。.!！？?；;：:、]\s*/g, "")
    .trim();
}

function cleanSilenceMarkers(value: string) {
  return value
    .replace(/<\|nospeech\|>/gi, " ")
    .replace(/<sil>/gi, " ")
    .trim();
}

function termReplacements(protectedTerms: string[]) {
  const has = (term: string) => protectedTerms.some((item) =>
    item.toLowerCase() === term.toLowerCase(),
  );
  const replacements: Array<[RegExp, string, string]> = [];
  if (has("同传")) replacements.push([/同船/g, "同传", "term_correction"]);
  if (has("同声传译")) {
    replacements.push([/同生传义/g, "同声传译", "term_correction"]);
  }
  if (has("端侧")) replacements.push([/端测/g, "端侧", "term_correction"]);
  if (has("断句")) replacements.push([/端局/g, "断句", "term_correction"]);
  if (has("语义组句")) {
    replacements.push([/语义[足主]句/g, "语义组句", "term_correction"]);
    replacements.push([/语意组句/g, "语义组句", "term_correction"]);
  }
  if (has("会议纪要")) replacements.push([/会议既要/g, "会议纪要", "term_correction"]);
  if (has("自动识别语言")) {
    replacements.push([/自动识别语音/g, "自动识别语言", "term_correction"]);
  }
  if (has("Qwen3 ASR")) {
    replacements.push([/\bTwin\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bKun\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bQin\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bQun\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bQuin\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bQuinn\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
    replacements.push([/\bCon\s*3\s*ASR\b/gi, "Qwen3 ASR", "term_correction"]);
  }
  if (has("Hy-MT2")) {
    replacements.push([/\bHi[-\s]?MT2\b/gi, "Hy-MT2", "term_correction"]);
    replacements.push([/\bHi\s*M\s*T\s*2\b/gi, "Hy-MT2", "term_correction"]);
    replacements.push([/\bHi[-\s]?M\s*T\s*Two\b/gi, "Hy-MT2", "term_correction"]);
    replacements.push([/\bHy[-\s]?M\s*T\s*Two\b/gi, "Hy-MT2", "term_correction"]);
  }
  if (has("VoxCPM2")) {
    replacements.push([/\bBox\s*CPM2\b/gi, "VoxCPM2", "term_correction"]);
    replacements.push([/\bBox\s*C\s*P\s*M\s*2\b/gi, "VoxCPM2", "term_correction"]);
    replacements.push([/\bVoice\s*CPM2\b/gi, "VoxCPM2", "term_correction"]);
    replacements.push([/\bVox\s*CPM\s*Two\b/gi, "VoxCPM2", "term_correction"]);
    replacements.push([/\bVox\s*C\s*P\s*M\s*Two\b/gi, "VoxCPM2", "term_correction"]);
  }
  if (has("筑基丹")) {
    replacements.push([/助机单/g, "筑基丹", "domain_term_correction"]);
    replacements.push([/助基丹/g, "筑基丹", "domain_term_correction"]);
    replacements.push([/筑机丹/g, "筑基丹", "domain_term_correction"]);
    replacements.push([/朱基丹/g, "筑基丹", "domain_term_correction"]);
  }
  if (has("命元丹")) {
    replacements.push([/命原丹/g, "命元丹", "domain_term_correction"]);
    replacements.push([/名元丹/g, "命元丹", "domain_term_correction"]);
  }
  if (has("雷劫")) {
    replacements.push([/雷杰/g, "雷劫", "domain_term_correction"]);
    replacements.push([/雷洁/g, "雷劫", "domain_term_correction"]);
  }
  if (has("灵脉之心")) {
    replacements.push([/灵麦之心/g, "灵脉之心", "domain_term_correction"]);
    replacements.push([/灵脉之芯/g, "灵脉之心", "domain_term_correction"]);
  }
  if (has("苟到化形")) {
    replacements.push([/狗道化形/g, "苟到化形", "domain_term_correction"]);
  }
  if (has("灵石")) {
    replacements.push([/[下三]?万六零石/g, "三万六灵石", "domain_term_correction"]);
  }
  if (has("报价") && has("合同")) {
    replacements.push([/报价合同/g, "报价、合同", "domain_term_correction"]);
  }
  if (has("检票口")) {
    replacements.push([/[点检]票[号口]/g, "检票口", "domain_term_correction"]);
  }
  if (has("甲状腺")) {
    replacements.push([/甲状[线限]/g, "甲状腺", "domain_term_correction"]);
  }
  if (has("结节")) {
    replacements.push([/节节/g, "结节", "domain_term_correction"]);
  }
  if (has("病历")) {
    replacements.push([/病力/g, "病历", "domain_term_correction"]);
  }
  if (has("处方")) {
    replacements.push([/处芳/g, "处方", "domain_term_correction"]);
  }
  if (has("化验单")) {
    replacements.push([/化验但/g, "化验单", "domain_term_correction"]);
  }
  if (has("过敏史")) {
    replacements.push([/过敏使/g, "过敏史", "domain_term_correction"]);
  }
  if (has("副作用")) {
    replacements.push([/负作用/g, "副作用", "domain_term_correction"]);
  }
  if (has("用药剂量")) {
    replacements.push([/用药计量/g, "用药剂量", "domain_term_correction"]);
  }
  replacements.push([/出机油/g, "出机缘", "domain_phrase_correction"]);
  replacements.push([/[练炼]机一枚/g, "炼制一枚", "domain_phrase_correction"]);
  replacements.push([/不金丹/g, "不，金丹", "domain_phrase_correction"]);
  if (has("A-120")) {
    replacements.push([/\bR[-\s]?120\b/g, "A-120", "identifier_correction"]);
  }
  return replacements;
}
