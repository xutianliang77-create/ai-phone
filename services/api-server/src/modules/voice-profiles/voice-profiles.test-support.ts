export function account(id: string, now: string) {
  return {
    id,
    phoneHash: `phone-${id}`,
    phoneMasked: "138****0000",
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };
}

export function session(token: string, userId: string, now: string) {
  return {
    token,
    userId,
    createdAt: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}

export function wavFixture(amplitude = 5000) {
  const sampleRate = 16000;
  const samples = sampleRate * 5;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(
      amplitude * Math.sin(2 * Math.PI * 220 * index / sampleRate),
    );
    wav.writeInt16LE(value, 44 + index * 2);
  }
  return wav;
}

export function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
