import { readFileSync } from "node:fs";

const MIN_SCREENSHOT_SIDE = 320;

export function isSupportedScreenshotImage(file: string) {
  try {
    const bytes = readFileSync(file);
    const dimensions = readPngDimensions(bytes) ?? readJpegDimensions(bytes);
    return Boolean(dimensions && dimensions.width >= MIN_SCREENSHOT_SIDE && dimensions.height >= MIN_SCREENSHOT_SIDE);
  } catch {
    return false;
  }
}

function readPngDimensions(bytes: Buffer) {
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readJpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (isStartOfFrame(marker) && length >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

function isStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}
