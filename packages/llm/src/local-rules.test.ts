import { describe, expect, it } from "vitest";
import { applyAsrLocalRules } from "./local-rules.js";

describe("ASR local rules", () => {
  it("repairs known model and product terms", () => {
    const result = applyAsrLocalRules(
      "我们测试同船，Twin3ASR、HiMT2、BoxCPM2、HiM T Two、Vox CPM Two 和 R120。",
    );

    expect(result.text).toBe(
      "我们测试同传，Qwen3 ASR、Hy-MT2、VoxCPM2、Hy-MT2、VoxCPM2 和 A-120。",
    );
    expect(result.operations).toContain("term_correction");
    expect(result.operations).toContain("identifier_correction");
  });

  it("removes silence markers", () => {
    expect(applyAsrLocalRules("<sil> hello <|nospeech|>").text).toBe("hello");
  });

  it("removes conservative fillers and repeated stutters", () => {
    const result = applyAsrLocalRules("啊，现在我我读读出来不习惯了啊。");

    expect(result.text).toBe("现在我读出来不习惯了。");
    expect(result.operations).toContain("disfluency_cleanup");
  });

  it("does not remove demonstratives inside normal noun phrases", () => {
    const result = applyAsrLocalRules("你为什么把这个座椅调这么低？");

    expect(result.text).toBe("你为什么把这个座椅调这么低？");
    expect(result.operations).not.toContain("disfluency_cleanup");
  });

  it("collapses repeated short Chinese stutter phrases", () => {
    const result = applyAsrLocalRules("我还我还我还受苦，我只能劝。");

    expect(result.text).toBe("我还受苦，我只能劝。");
    expect(result.operations).toContain("disfluency_cleanup");
  });

  it("repairs project domain ASR confusions", () => {
    const result = applyAsrLocalRules(
      "现在端局不稳定，会议既要稍后整理，端测 ASR 继续观察。",
    );

    expect(result.text).toBe(
      "现在断句不稳定，会议纪要稍后整理，端侧 ASR 继续观察。",
    );
    expect(result.operations).toContain("term_correction");
  });

  it("repairs server-side cultivation glossary confusions", () => {
    const result = applyAsrLocalRules(
      "注销二十份助机单材料，狗道化形再出关，我的下万六零石呢？这下老师出机油啊，顶多足够练机一枚。",
    );

    expect(result.text).toBe(
      "注销二十份筑基丹材料，苟到化形再出关，我的三万六灵石呢？这下老师出机缘啊，顶多足够炼制一枚。",
    );
    expect(result.operations).toContain("domain_term_correction");
    expect(result.operations).toContain("domain_phrase_correction");
  });

  it("repairs selected industry glossary confusions", () => {
    const result = applyAsrLocalRules(
      "下午三点讨论报价合同，演唱会座位号和点票号在哪里？",
      ["报价", "合同", "检票口", "座位号"],
    );

    expect(result.text).toBe(
      "下午三点讨论报价、合同，演唱会座位号和检票口在哪里？",
    );
    expect(result.operations).toContain("domain_term_correction");
  });

  it("repairs selected medical glossary confusions", () => {
    const result = applyAsrLocalRules(
      "我想看一下甲状线节节的化验但和病力，确认过敏使和用药计量。",
      ["甲状腺", "结节", "化验单", "病历", "过敏史", "用药剂量"],
    );

    expect(result.text).toBe(
      "我想看一下甲状腺结节的化验单和病历，确认过敏史和用药剂量。",
    );
    expect(result.operations).toContain("domain_term_correction");
  });
});
