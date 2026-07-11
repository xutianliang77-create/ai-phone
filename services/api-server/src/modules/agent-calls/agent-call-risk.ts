const riskPatterns = [
  { reason: "payment", pattern: /付款|支付|转账|收款|退款|pay|payment|transfer|refund/i },
  { reason: "identity_verification", pattern: /身份|验证码|密码|实名|verify|password|otp|identity/i },
  { reason: "contract", pattern: /合同|签约|协议|contract|agreement/i },
  { reason: "medical", pattern: /医疗|医生|诊断|处方|medical|doctor|diagnosis/i },
  { reason: "legal", pattern: /法律|诉讼|律师|legal|lawsuit|lawyer/i },
  { reason: "financial", pattern: /金融|贷款|保险|投资|finance|loan|insurance|investment/i },
];

export function classifyAgentCallRisk(input: {
  objective: string;
  suggestedScript?: string;
}) {
  const text = `${input.objective}\n${input.suggestedScript ?? ""}`;
  const riskReasons = riskPatterns
    .filter((item) => item.pattern.test(text))
    .map((item) => item.reason);
  return {
    riskLevel: riskReasons.length > 0 ? "requires_human_takeover" : "low",
    riskReasons,
  } as const;
}
