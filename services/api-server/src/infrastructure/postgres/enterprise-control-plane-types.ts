export interface EnterpriseControlPlaneConfig {
  workerId: string;
  region: string;
  buildCommit: string;
  imageDigest: string;
  pollIntervalMs: number;
  batchSize: number;
  leaseMs: number;
  expectedReplicas: number;
  maxProvisionBacklogSeconds: number;
}

export interface EnterpriseControlPlanePool {
  connect(): Promise<{
    query<Row extends Record<string, unknown>>(
      sql: string,
      values?: unknown[],
    ): Promise<{ rows: Row[] }>;
    release(): void;
  }>;
}
