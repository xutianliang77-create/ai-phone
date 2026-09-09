// Generated from frozen v1.0 898ee517e7aac00b03bc79ff2d0597dd00fdbf56; no new correction rules.
const defaultAsrProtectedTerms = <String>[
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
  "iPhone 14"
];
const asrTermRules = <(String, String, bool, String, List<String>)>[
  ("同船", "同传", false, "term_correction", ["同传"]),
  ("同生传义", "同声传译", false, "term_correction", ["同声传译"]),
  ("端测", "端侧", false, "term_correction", ["端侧"]),
  ("端局", "断句", false, "term_correction", ["断句"]),
  ("语义[足主]句", "语义组句", false, "term_correction", ["语义组句"]),
  ("语意组句", "语义组句", false, "term_correction", ["语义组句"]),
  ("会议既要", "会议纪要", false, "term_correction", ["会议纪要"]),
  ("自动识别语音", "自动识别语言", false, "term_correction", ["自动识别语言"]),
  (
    "\\bTwin\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bKun\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bQin\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bQun\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bQuin\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bQuinn\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  (
    "\\bCon\\s*3\\s*ASR\\b",
    "Qwen3 ASR",
    true,
    "term_correction",
    ["Qwen3 ASR"]
  ),
  ("\\bHi[-\\s]?MT2\\b", "Hy-MT2", true, "term_correction", ["Hy-MT2"]),
  ("\\bHi\\s*M\\s*T\\s*2\\b", "Hy-MT2", true, "term_correction", ["Hy-MT2"]),
  (
    "\\bHi[-\\s]?M\\s*T\\s*Two\\b",
    "Hy-MT2",
    true,
    "term_correction",
    ["Hy-MT2"]
  ),
  (
    "\\bHy[-\\s]?M\\s*T\\s*Two\\b",
    "Hy-MT2",
    true,
    "term_correction",
    ["Hy-MT2"]
  ),
  ("\\bBox\\s*CPM2\\b", "VoxCPM2", true, "term_correction", ["VoxCPM2"]),
  (
    "\\bBox\\s*C\\s*P\\s*M\\s*2\\b",
    "VoxCPM2",
    true,
    "term_correction",
    ["VoxCPM2"]
  ),
  ("\\bVoice\\s*CPM2\\b", "VoxCPM2", true, "term_correction", ["VoxCPM2"]),
  ("\\bVox\\s*CPM\\s*Two\\b", "VoxCPM2", true, "term_correction", ["VoxCPM2"]),
  (
    "\\bVox\\s*C\\s*P\\s*M\\s*Two\\b",
    "VoxCPM2",
    true,
    "term_correction",
    ["VoxCPM2"]
  ),
  ("助机单", "筑基丹", false, "domain_term_correction", ["筑基丹"]),
  ("助基丹", "筑基丹", false, "domain_term_correction", ["筑基丹"]),
  ("筑机丹", "筑基丹", false, "domain_term_correction", ["筑基丹"]),
  ("朱基丹", "筑基丹", false, "domain_term_correction", ["筑基丹"]),
  ("命原丹", "命元丹", false, "domain_term_correction", ["命元丹"]),
  ("名元丹", "命元丹", false, "domain_term_correction", ["命元丹"]),
  ("雷杰", "雷劫", false, "domain_term_correction", ["雷劫"]),
  ("雷洁", "雷劫", false, "domain_term_correction", ["雷劫"]),
  ("灵麦之心", "灵脉之心", false, "domain_term_correction", ["灵脉之心"]),
  ("灵脉之芯", "灵脉之心", false, "domain_term_correction", ["灵脉之心"]),
  ("狗道化形", "苟到化形", false, "domain_term_correction", ["苟到化形"]),
  ("[下三]?万六零石", "三万六灵石", false, "domain_term_correction", ["灵石"]),
  ("报价合同", "报价、合同", false, "domain_term_correction", ["报价", "合同"]),
  ("[点检]票[号口]", "检票口", false, "domain_term_correction", ["检票口"]),
  ("甲状[线限]", "甲状腺", false, "domain_term_correction", ["甲状腺"]),
  ("节节", "结节", false, "domain_term_correction", ["结节"]),
  ("病力", "病历", false, "domain_term_correction", ["病历"]),
  ("处芳", "处方", false, "domain_term_correction", ["处方"]),
  ("化验但", "化验单", false, "domain_term_correction", ["化验单"]),
  ("过敏使", "过敏史", false, "domain_term_correction", ["过敏史"]),
  ("负作用", "副作用", false, "domain_term_correction", ["副作用"]),
  ("用药计量", "用药剂量", false, "domain_term_correction", ["用药剂量"]),
  ("出机油", "出机缘", false, "domain_phrase_correction", []),
  ("[练炼]机一枚", "炼制一枚", false, "domain_phrase_correction", []),
  ("不金丹", "不，金丹", false, "domain_phrase_correction", []),
  ("\\bR[-\\s]?120\\b", "A-120", false, "identifier_correction", ["A-120"]),
  ("\\bA\\s*杠\\s*120\\b", "A-120", false, "identifier_correction", ["A-120"]),
  (
    "\\bA\\s*杠\\s*(?:幺|一)二零",
    "A-120",
    false,
    "identifier_correction",
    ["A-120"]
  ),
];
const asrSilenceRules = <(String, String, bool)>[
  ("<\\|nospeech\\|>", " ", true),
  ("<sil>", " ", true)
];
const asrDisfluencyRules = <(String, String, bool)>[
  (
    "([，,。.!！？?；;：:、\\s]|^)(嗯+|呃+|啊+|呐+|哎+|哎呀|那个|这个)(?=([，,。.!！？?；;：:、\\s]|\$))",
    "\$1",
    false
  ),
  ("(嗯+|呃+|啊+|呐+)(?=([。.!！？?；;：:]|\$))", "", false),
  ("\\b(um+|uh+|er+|ah+)\\b[,.!?;:]?\\s*", "", true),
  ("([我你他她它])\\1+(?=[\\u4e00-\\u9fff])", "\$1", false),
  ("(我还|我也|我就|我只|你还|你也|你就|他还|他也|他就)\\1+(?=[\\u4e00-\\u9fff])", "\$1", false),
  ("读读(?=出来|一遍|一下)", "读", false),
  ("说说(?=出来|清楚|一下)", "说", false),
  ("([，,。.!！？?；;：:、])\\s*([，,。.!！？?；;：:、])+", "\$1", false),
  ("^\\s*[，,。.!！？?；;：:、]\\s*", "", false)
];
