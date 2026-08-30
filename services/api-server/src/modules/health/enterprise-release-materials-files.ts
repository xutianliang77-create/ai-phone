import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const MAX_RELEASE_FILE_BYTES = 2 * 1024 * 1024;

export function releaseFileIssues(input: {
  label: string;
  path: unknown;
  sha256: unknown;
  repositoryRoot: string;
  rejectDraftMarkers?: boolean;
}) {
  if (!isText(input.path)) return [`${input.label} missing path`];
  if (!isSha256(input.sha256)) return [`${input.label} invalid sha256`];
  if (isAbsolute(input.path)) return [`${input.label} path must be relative`];

  let root: string;
  try {
    root = realpathSync(input.repositoryRoot);
  } catch {
    return [`${input.label} repository root is unreadable`];
  }
  const candidate = resolve(root, input.path);
  const inside = relative(root, candidate);
  if (inside === "" || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    return [`${input.label} path escapes repository`];
  }

  try {
    if (lstatSync(candidate).isSymbolicLink()) {
      return [`${input.label} path must not be a symlink`];
    }
    const real = realpathSync(candidate);
    if (real !== root && !real.startsWith(`${root}${sep}`)) {
      return [`${input.label} path escapes repository`];
    }
    const stat = statSync(real);
    if (!stat.isFile()) return [`${input.label} path is not a file`];
    if (stat.size === 0 || stat.size > MAX_RELEASE_FILE_BYTES) {
      return [`${input.label} file size is invalid`];
    }
    const content = readFileSync(real);
    const actual = createHash("sha256").update(content).digest("hex");
    const issues = actual === input.sha256
      ? []
      : [`${input.label} sha256 mismatch`];
    if (input.rejectDraftMarkers && hasDraftMarker(content.toString("utf8"))) {
      issues.push(`${input.label} contains draft markers`);
    }
    return issues;
  } catch {
    return [`${input.label} file is unreadable`];
  }
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) &&
    !/^0+$/.test(value);
}

export function isCommitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value) &&
    !/^0+$/.test(value);
}

export function isImageDigest(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) &&
    !/^sha256:0+$/.test(value);
}

export function isTimestamp(value: unknown): value is string {
  if (!isText(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= Date.now() + 5 * 60_000;
}

export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    value.length <= 240 && !isPlaceholder(value);
}

function hasDraftMarker(value: string) {
  return /\b(?:todo|tbd|placeholder|replace-with)\b|待填|待定|未批准/iu.test(value);
}

function isPlaceholder(value: string) {
  return /example\.(?:com|org)|localhost|translation\.local|replace-with|待填|^todo$/iu.test(
    value,
  );
}
