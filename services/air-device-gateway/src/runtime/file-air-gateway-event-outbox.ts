import type { AirGatewayEventOutbox } from
  "./air-gateway-carrier-dispatcher.js";
import { AtomicJsonRecordStore } from "./atomic-json-record-store.js";

interface EventWithId {
  eventId: string;
}

export class FileAirGatewayEventOutbox<T extends EventWithId>
implements AirGatewayEventOutbox<T> {
  private readonly store: AtomicJsonRecordStore<T>;

  constructor(path: string) {
    this.store = new AtomicJsonRecordStore(path, {
      label: "Air Gateway event outbox",
      idOf: (event) => typeof event?.eventId === "string" ? event.eventId : null,
    });
  }

  load() {
    return this.store.load();
  }

  put(event: T) {
    return this.store.upsert(event);
  }

  remove(eventId: string) {
    return this.store.remove(eventId);
  }
}
