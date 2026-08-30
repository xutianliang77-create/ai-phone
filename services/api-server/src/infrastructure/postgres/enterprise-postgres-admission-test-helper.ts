export function admissionTestRows(sql: string, values?: unknown[]) {
  if (sql.includes("reserve_tenant_admission")) {
    return [{
      result_status: "admitted",
      admission_id: values?.[0],
      used_cell: 1,
      cell_limit: 10,
      used_tenant: 1,
      tenant_limit: 2,
      queue_position: 0,
      retry_after_ms: 0,
    }];
  }
  if (sql.includes("renew_tenant_admission")) return [{ renewed: true }];
  if (sql.includes("release_tenant_admission")) return [{ released: true }];
  if (sql.includes("tenant_admission_is_active")) return [{ active: true }];
  return [];
}
