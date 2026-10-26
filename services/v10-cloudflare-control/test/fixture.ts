// A13 HOST-only fixture. This is never imported by src/index.ts or a production adapter.
// SQLite transaction behavior is NOT evidence of actual D1 concurrency/limits/runtime.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { D1Binding, D1Session, D1Statement, D1Value, D1Result } from "../vendor/reused-control-core.mjs";
import { D1CommandStore } from "../vendor/reused-control-core.mjs";
import { D1QueryBudget } from "../vendor/reused-control-core.mjs";
import { tokenHash } from "./fixture-grants.mjs";

export const now = 1_800_000_000_000;
export const bundle = "com.example.wujie.public";
export const team = "ABCDE12345";
export const deployment = "synthetic-public-d1";
export const scope = `${team}:${bundle}`;

class Statement implements D1Statement {
  values: D1Value[] = [];
  constructor(readonly db: DatabaseSync, readonly query: string) {}
  bind(...values: D1Value[]) { this.values = values; return this; }
  async first<T>() { return (this.db.prepare(this.query).get(...this.values) ?? null) as T | null; }
  async all<T>() { return {success:true,results:this.db.prepare(this.query).all(...this.values) as T[],meta:{}}; }
}
export class Fixture implements D1Binding {
  readonly db = new DatabaseSync(":memory:");
  constructor(kind:"commerce"|"content"="commerce") {
    const migration=kind==="commerce"?"commerce/0001_accounts_commerce.sql":"content/0001_model_configuration.sql";
    this.db.exec(readFileSync(new URL(`./sql/${migration}`, import.meta.url), "utf8"));
    // Synthetic A11 fixture only. Production migrations remain blocked until A12/A13.
    this.db.exec(readFileSync(new URL(`./sql/${kind==="commerce"?"commerce/0008_maintenance.sql":"content/0005_recovery.sql"}`,import.meta.url),"utf8"));
    this.db.exec("UPDATE recovery_control SET epoch=1,state='ready' WHERE id=1");
    if(kind==="commerce")this.db.exec("UPDATE writer_control SET write_enabled=1 WHERE id=1");
  }
  withSession(): D1Session {
    return {
      prepare: query => new Statement(this.db, query),
      batch: async <T>(statements: D1Statement[]): Promise<D1Result<T>[]> => {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const results = statements.map(s => {
            const v = s as Statement, statement=this.db.prepare(v.query);
            if(statement.columns().length)return {success:true,results:statement.all(...v.values) as T[],meta:{changes:0}};
            const meta=statement.run(...v.values);
            return { success: true, results: [] as T[], meta: { changes: Number(meta.changes) } };
          });
          this.db.exec("COMMIT"); return results;
        } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      },
    };
  }
  store(fence = 1, limit = 50) { return new D1CommandStore(this, fence, new D1QueryBudget(limit),"commerce",1); }
  seedUser(id: string, token = `synthetic-${id}`) {
    const identity = `identity-${id}`, accountToken = randomUUID();
    this.db.prepare("INSERT INTO accounts(user_id,app_account_token,status,authorization_epoch,created_ms,updated_ms) VALUES (?,?,'active',1,?,?)")
      .run(id, accountToken, now, now);
    this.db.prepare("INSERT INTO usage_accounts VALUES (?,0,0,1,?)").run(id, now);
    this.db.prepare("INSERT INTO identities(identity_key,provider,issuer,scope,subject_hash,user_id,created_ms) VALUES (?,'apple','https://appleid.apple.com',?,?,?,?)")
      .run(identity, scope, id, id, now);
    this.db.prepare("INSERT INTO account_tokens(token_hash,user_id,identity_key,authorization_epoch,created_ms,expires_ms) VALUES (?,?,?,1,?,?)")
      .run(tokenHash(token), id, identity, now, now + 30 * 86_400_000);
    return { id, token, tokenHash: tokenHash(token), appAccountToken: accountToken };
  }
  count(table: string) {
    if (!/^[a-z_]+$/.test(table)) throw Error("fixture_table_name");
    return Number(this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n);
  }
  close() { this.db.close(); }
}
