export interface AccountDeploymentReadiness {
  status: "ready" | "not_ready";
  nodeEnv: string;
  otpSecret: "configured" | "missing" | "weak";
  debugCodeExposure: "disabled" | "enabled";
  testAutoAccount: "disabled" | "enabled";
  issues: string[];
}

const devOtpSecret = "local-dev-otp-secret";

export function getAccountDeploymentReadiness(): AccountDeploymentReadiness {
  const nodeEnv = process.env.NODE_ENV ?? "unset";
  const otpSecret = otpSecretStatus();
  const debugCodeExposure = debugCodeExposureStatus(nodeEnv);
  const testAutoAccount = testAutoAccountStatus();
  const issues = [
    ...otpSecretIssues(otpSecret),
    ...(nodeEnv === "production"
      ? []
      : ["account NODE_ENV must be production"]),
    ...(debugCodeExposure === "disabled"
      ? []
      : ["account debug OTP must be disabled"]),
    ...(testAutoAccount === "disabled"
      ? []
      : ["account test auto account must be disabled"]),
  ];

  return {
    status: issues.length === 0 ? "ready" : "not_ready",
    nodeEnv,
    otpSecret,
    debugCodeExposure,
    testAutoAccount,
    issues,
  };
}

function otpSecretStatus(): AccountDeploymentReadiness["otpSecret"] {
  const secret = process.env.AUTH_OTP_SECRET?.trim();
  if (!secret) return "missing";
  return isWeakSecret(secret) ? "weak" : "configured";
}

function otpSecretIssues(status: AccountDeploymentReadiness["otpSecret"]) {
  if (status === "missing") return ["account missing AUTH_OTP_SECRET"];
  if (status === "weak") return ["account invalid AUTH_OTP_SECRET"];
  return [];
}

function debugCodeExposureStatus(
  nodeEnv: string,
): AccountDeploymentReadiness["debugCodeExposure"] {
  return nodeEnv !== "production" || process.env.AUTH_DEBUG_OTP === "true"
    ? "enabled"
    : "disabled";
}

function testAutoAccountStatus(): AccountDeploymentReadiness["testAutoAccount"] {
  const explicitlyEnabled = process.env.API_TEST_AUTO_ACCOUNT === "true";
  const vitestFallbackEnabled =
    Boolean(process.env.VITEST) &&
    process.env.API_TEST_AUTO_ACCOUNT !== "false";
  return explicitlyEnabled || vitestFallbackEnabled ? "enabled" : "disabled";
}

function isWeakSecret(secret: string) {
  const normalized = secret.toLowerCase();
  return (
    secret === devOtpSecret ||
    secret.length < 24 ||
    normalized.startsWith("replace-with") ||
    normalized.includes("changeme")
  );
}
