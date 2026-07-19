export interface InboxEventRecord {
  eventId: string;
  sessionId: string;
  eventType: string;
  payloadHash: string;
  receivedAt: string;
  processedAt: string;
}

export interface OutboxEventRecord {
  idempotencyKey: string;
  sessionId: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  availableAt: string;
  createdAt: string;
  publishedAt?: string;
  lastError?: string;
}
