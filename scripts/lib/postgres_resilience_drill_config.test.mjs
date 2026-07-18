import { describe, expect, it } from "vitest";
import { validatePostgresResilienceDrillConfig } from
  "./postgres_resilience_drill_config.mjs";
import { validPostgresResilienceDrillConfig as config } from
  "./postgres_resilience_drill_fixture.mjs";

describe("PostgreSQL resilience drill config", () => {
  it("accepts managed HA with isolated verify-full restore", () => {
    expect(validatePostgresResilienceDrillConfig(config()).status).toBe("ready");
  });

  it("accepts Patroni only with three DCS failure domains", () => {
    const value = config();
    value.ha.mode = "patroni_etcd";
    value.ha.dcsVoters = 3;
    value.ha.dcsFailureDomains = ["zone-a", "zone-b", "zone-c"];
    expect(validatePostgresResilienceDrillConfig(value).status).toBe("ready");

    value.ha.dcsFailureDomains = ["zone-a", "zone-b"];
    expect(validatePostgresResilienceDrillConfig(value).issues).toContain(
      "Patroni requires three DCS voters and failure domains",
    );
  });

  it("rejects same database restore and missing off-host protections", () => {
    const value = config();
    value.safety.restoreDatabase = "ai_phone_staging";
    value.safety.tlsMode = "require";
    value.wal.requireImmutability = false;
    const checked = validatePostgresResilienceDrillConfig(value);

    expect(checked.status).toBe("not_ready");
    expect(checked.issues).toContain("restoreDatabase must be a dedicated isolated database");
    expect(checked.issues).toContain("PostgreSQL TLS must be verify-full");
    expect(checked.issues).toContain("WAL encryption and immutability are mandatory");
  });
});
