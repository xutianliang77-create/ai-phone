export interface EnterpriseInboxEventRecord {
  id: string;
  tenantId: string;
  source: string;
  sourceEventId: string;
  eventType: string;
  payloadHash: string;
  payload: unknown;
  traceId: string;
  receivedAt: string;
  processedAt: string;
}

export interface EnterpriseOutboxEventRecord {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  idempotencyKey: string;
  payload: unknown;
  traceId: string;
  attempts: number;
  availableAt: string;
  leaseExpiresAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  publishedAt?: string;
}
