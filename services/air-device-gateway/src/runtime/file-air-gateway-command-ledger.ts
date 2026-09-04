import type {
  AirGatewayCommandLedger,
  AirGatewayCommandLedgerRecord,
} from "./air-gateway-command-ledger.js";
import { AtomicJsonRecordStore } from "./atomic-json-record-store.js";

export class FileAirGatewayCommandLedger implements AirGatewayCommandLedger {
  private readonly store: AtomicJsonRecordStore<AirGatewayCommandLedgerRecord>;

  constructor(path: string) {
    this.store = new AtomicJsonRecordStore(path, {
      label: "Air Gateway command ledger",
      idOf: (record) => typeof record?.commandId === "string"
        ? record.commandId
        : null,
    });
  }

  load() {
    return this.store.load();
  }

  upsert(record: AirGatewayCommandLedgerRecord) {
    return this.store.upsert(record);
  }

  remove(commandId: string) {
    return this.store.remove(commandId);
  }
}
