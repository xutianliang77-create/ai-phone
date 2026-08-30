const admissionFunctions = new Set([
  "reserve_tenant_admission",
  "renew_tenant_admission",
  "release_tenant_admission",
  "tenant_admission_is_active",
]);

export function assertEnterpriseAdmissionSql(sql: string) {
  const normalized = sql.replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /^select\b[\s\S]*\bfrom\s+enterprise\.([a-z_][a-z0-9_]*)\s*\(/i,
  );
  const functionName = match?.[1]?.toLowerCase();
  if (!functionName || !admissionFunctions.has(functionName) ||
    normalized.includes(";") ||
    /\b(?:join|union|insert|update|delete)\b/i.test(normalized) ||
    !/\(\s*\$1::uuid\s*,/i.test(normalized)) {
    throw new Error("Enterprise admission SQL must call one scoped function");
  }
}
