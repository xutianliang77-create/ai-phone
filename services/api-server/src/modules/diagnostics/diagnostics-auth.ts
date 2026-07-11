export function verifyDiagnosticsAdmin(authorization: string | undefined) {
  const token = process.env.DIAGNOSTICS_ADMIN_TOKEN;
  if (!token) {
    return {
      ok: false as const,
      statusCode: 503,
      code: "diagnostics_admin_not_configured",
      message: "Diagnostics admin token is not configured",
    };
  }
  if (authorization !== `Bearer ${token}`) {
    return {
      ok: false as const,
      statusCode: 401,
      code: "diagnostics_admin_unauthorized",
      message: "Unauthorized diagnostics request",
    };
  }
  return { ok: true as const };
}

export function diagnosticsAdminStatus() {
  return process.env.DIAGNOSTICS_ADMIN_TOKEN
    ? "configured"
    : "configuration_required";
}
