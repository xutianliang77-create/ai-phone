const MAX_UINT64 = 0xffffffffffffffffn;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export class VuartV1PayloadWriter {
  private readonly parts: Uint8Array[] = [];

  u8(value: number, name: string) { this.number(value, 1, name); }
  u16(value: number, name: string) { this.number(value, 2, name); }
  u32(value: number, name: string) { this.number(value, 4, name); }

  u64(value: bigint, name: string) {
    if (typeof value !== "bigint" || value < 0n || value > MAX_UINT64) {
      throw new Error(`${name} must be uint64`);
    }
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.parts.push(bytes);
  }

  identifier(value: string, maximum: number, name: string) {
    this.text(value, maximum, name, IDENTIFIER);
  }

  text(value: string, maximum: number, name: string, pattern: RegExp) {
    if (typeof value !== "string" || value.length < 1 || value.length > maximum ||
      !pattern.test(value)) throw new Error(`VUART v1 ${name} invalid`);
    this.u8(value.length, `${name}Length`);
    this.parts.push(Uint8Array.from(value, (character) => character.charCodeAt(0)));
  }

  take() {
    const output = new Uint8Array(this.parts.reduce(
      (total, part) => total + part.byteLength,
      0,
    ));
    let offset = 0;
    for (const part of this.parts) {
      output.set(part, offset);
      offset += part.byteLength;
    }
    return output;
  }

  private number(value: number, bytes: 1 | 2 | 4, name: string) {
    const maximum = bytes === 4 ? 0xffffffff : 2 ** (bytes * 8) - 1;
    if (!isVuartV1Uint(value, maximum)) {
      throw new Error(`${name} must be uint${bytes * 8}`);
    }
    const output = new Uint8Array(bytes);
    const view = new DataView(output.buffer);
    if (bytes === 1) output[0] = value;
    if (bytes === 2) view.setUint16(0, value, true);
    if (bytes === 4) view.setUint32(0, value, true);
    this.parts.push(output);
  }
}

export class VuartV1PayloadReader {
  private offset = 0;
  private readonly view: DataView;

  constructor(private readonly payload: Uint8Array) {
    this.view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  }

  version(expected: number) {
    if (this.u8("payloadVersion") !== expected) {
      throw new Error("VUART v1 payload version unsupported");
    }
  }

  u8(name: string) { return this.number(1, name); }
  u16(name: string) { return this.number(2, name); }
  u32(name: string) { return this.number(4, name); }

  u64(name: string) {
    this.require(8, name);
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  identifier(maximum: number, name: string) {
    return this.text(maximum, name, IDENTIFIER);
  }

  text(maximum: number, name: string, pattern: RegExp) {
    const length = this.u8(`${name}Length`);
    if (length < 1 || length > maximum) {
      throw new Error(`VUART v1 ${name} length invalid`);
    }
    this.require(length, name);
    const value = String.fromCharCode(
      ...this.payload.slice(this.offset, this.offset + length),
    );
    this.offset += length;
    if (!pattern.test(value)) throw new Error(`VUART v1 ${name} invalid`);
    return value;
  }

  end() {
    if (this.offset !== this.payload.byteLength) {
      throw new Error("VUART v1 payload has trailing bytes");
    }
  }

  private number(bytes: 1 | 2 | 4, name: string) {
    this.require(bytes, name);
    const value = bytes === 1 ? this.payload[this.offset]!
      : bytes === 2 ? this.view.getUint16(this.offset, true)
        : this.view.getUint32(this.offset, true);
    this.offset += bytes;
    return value;
  }

  private require(length: number, name: string) {
    if (this.offset + length > this.payload.byteLength) {
      throw new Error(`VUART v1 payload truncated at ${name}`);
    }
  }
}

export function reverseVuartV1Code<T extends string>(
  input: Record<T, number>,
  value: number,
  name: string,
) {
  const entry = Object.entries(input).find(([, code]) => code === value);
  if (!entry) throw new Error(`VUART v1 ${name} unsupported`);
  return entry[0] as T;
}

export function isVuartV1Uint(value: number, maximum: number) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}
