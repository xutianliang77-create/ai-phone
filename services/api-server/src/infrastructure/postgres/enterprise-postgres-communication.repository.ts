import type {
  EnterpriseTenantPostgresSession,
} from "./enterprise-postgres-tenant-session.js";

export interface EnterpriseCommunicationResource {
  id: string;
  sessionId: string;
  scopeType: "tenant";
  scopeId: string;
  resourceType:
    | "session"
    | "leg"
    | "dispatch"
    | "provider_operation"
    | "playback"
    | "participant_consent";
}

interface ScopedResourceRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  scope_type: string;
  scope_id: string;
}

export function createEnterpriseCommunicationPostgresRepository(
  session: EnterpriseTenantPostgresSession,
) {
  return new EnterpriseCommunicationPostgresRepository(session);
}

export class EnterpriseCommunicationPostgresRepository {
  constructor(private readonly session: EnterpriseTenantPostgresSession) {}

  findSession(sessionId: string) {
    return this.findOne("session", sessionId, `
      SELECT resource.id, resource.id AS session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.communication_sessions resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.id = $3
    `, [sessionId]);
  }

  listSessionLegs(sessionId: string) {
    return this.findMany("leg", sessionId, `
      SELECT resource.id, resource.session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.session_media_legs resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.session_id = $3
      ORDER BY resource.id
    `, [sessionId]);
  }

  findDispatch(dispatchId: string) {
    return this.findOne("dispatch", dispatchId, `
      SELECT resource.id, resource.session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.worker_dispatches resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.id = $3
    `, [dispatchId]);
  }

  findProviderOperation(operationId: string) {
    return this.findOne("provider_operation", operationId, `
      SELECT resource.id, resource.session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.provider_operations resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.id = $3
    `, [operationId]);
  }

  findPlayback(sessionId: string, playbackId: string) {
    requiredId(sessionId);
    return this.findOne("playback", playbackId, `
      SELECT resource.id, resource.session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.tts_playbacks resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.session_id = $3 AND resource.id = $4
    `, [sessionId, playbackId]);
  }

  listParticipantConsents(sessionId: string) {
    return this.findMany("participant_consent", sessionId, `
      SELECT resource.id, resource.session_id,
        resource.scope_type, resource.scope_id
      FROM ai_phone.participant_recording_consents resource
      WHERE resource.scope_type = $1 AND resource.scope_id = $2
        AND resource.session_id = $3
      ORDER BY resource.id
    `, [sessionId]);
  }

  private async findOne(
    type: EnterpriseCommunicationResource["resourceType"],
    requestedId: string,
    sql: string,
    values: string[],
  ) {
    requiredId(requestedId);
    const result = await this.session.queryCommunication<ScopedResourceRow>(
      sql,
      values,
    );
    const resources = result.rows.map((row) => this.mapRow(type, row));
    if (resources.length > 1) {
      throw new Error("Enterprise communication query returned duplicate resources");
    }
    const resource = resources[0] ?? null;
    if (resource && resource.id !== requestedId) {
      throw new Error("Enterprise communication query returned the wrong resource");
    }
    return resource;
  }

  private async findMany(
    type: EnterpriseCommunicationResource["resourceType"],
    requestedId: string,
    sql: string,
    values: string[],
  ) {
    requiredId(requestedId);
    const result = await this.session.queryCommunication<ScopedResourceRow>(
      sql,
      values,
    );
    const resources = result.rows.map((row) => this.mapRow(type, row));
    if (resources.some((resource) => resource.sessionId !== requestedId)) {
      throw new Error("Enterprise communication query returned the wrong session");
    }
    return resources;
  }

  private mapRow(
    resourceType: EnterpriseCommunicationResource["resourceType"],
    row: ScopedResourceRow,
  ): EnterpriseCommunicationResource {
    if (row.scope_type !== "tenant" ||
      row.scope_id !== this.session.context.tenantId) {
      throw new Error("Enterprise communication resource is outside tenant scope");
    }
    return {
      id: requiredId(row.id),
      sessionId: requiredId(row.session_id),
      scopeType: "tenant",
      scopeId: this.session.context.tenantId,
      resourceType,
    };
  }
}

function requiredId(value: unknown) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  if (!cleaned || Buffer.byteLength(cleaned) > 200) {
    throw new Error("Invalid enterprise communication resource id");
  }
  return cleaned;
}
