export interface AppErrorReportRecord {
  id: string;
  eventType: string;
  message: string;
  stackTrace?: string;
  fatal: boolean;
  platform?: string;
  appVersion?: string;
  buildNumber?: string;
  regionEdition?: string;
  dataRegion?: string;
  occurredAt: string;
  receivedAt: string;
  context?: Record<string, unknown>;
}

export interface AppErrorReportFilter {
  eventType?: string;
  fatal?: boolean;
  platform?: string;
  since?: string;
  limit?: number;
}

export interface AppErrorReportSummary {
  status: "ok" | "attention_required";
  total: number;
  fatal: number;
  nonFatal: number;
  byEventType: Record<string, number>;
  byPlatform: Record<string, number>;
  byAppVersion: Record<string, number>;
  latestReceivedAt?: string;
  since?: string;
  retainedLimit: number;
}
