export type LiveKitComponentStatus =
  | "verified"
  | "candidate_unverified"
  | "not_integrated";

export interface LiveKitPackageVersion {
  version: string;
  status: LiveKitComponentStatus;
}

export interface LiveKitImageVersion {
  repository: string;
  tag?: string;
  digest?: string;
  status: LiveKitComponentStatus;
}

export interface LiveKitCompatibilityProfile {
  schemaVersion: 1;
  profileVersion: string;
  verifiedAt?: string;
  packages: {
    serverSdk: LiveKitPackageVersion;
    browserClient: LiveKitPackageVersion;
    rtcNode: LiveKitPackageVersion;
    flutterClient: LiveKitPackageVersion;
    agentsJs: LiveKitPackageVersion;
  };
  images: {
    server: LiveKitImageVersion;
    sip: LiveKitImageVersion;
    egress: LiveKitImageVersion;
    ingress: LiveKitImageVersion;
  };
}

export function liveKitImageReference(image: LiveKitImageVersion) {
  if (!image.tag) return null;
  const versioned = `${image.repository}:${image.tag}`;
  return image.digest ? `${versioned}@${image.digest}` : versioned;
}

export function isReleaseReadyLiveKitProfile(
  profile: LiveKitCompatibilityProfile,
) {
  return [
    ...Object.values(profile.packages),
    ...Object.values(profile.images),
  ].every((component) => {
    if (component.status === "not_integrated") return true;
    return component.status === "verified" &&
      ("repository" in component ? isSha256Digest(component.digest) : true);
  });
}

function isSha256Digest(value: unknown) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
