export type SerialDataListener = (data: Uint8Array) => void;
export type SerialDisconnectListener = (reason: string) => void;

export interface SerialTransport {
  readonly path: string;
  readonly isOpen: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  onData(listener: SerialDataListener): () => void;
  onDisconnect(listener: SerialDisconnectListener): () => void;
}
