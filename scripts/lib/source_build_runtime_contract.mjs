export function hasLockedLinuxFfmpegRuntime(packageJson, dockerfile) {
  let manifest;
  try {
    manifest = JSON.parse(packageJson);
  } catch {
    return false;
  }
  return manifest.optionalDependencies?.["@ffmpeg-installer/linux-x64"] ===
      "4.1.0" &&
    dockerfile.includes("npm ci") &&
    dockerfile.includes(
      "test -x node_modules/@ffmpeg-installer/linux-x64/ffmpeg",
    );
}
