import fs from "node:fs";

export function parseAliasPipelineArgs(values) {
  const options = Object.fromEntries(values.flatMap((value, index) =>
    value.startsWith("--") && values[index + 1] &&
      !values[index + 1].startsWith("--")
      ? [[value.slice(2), values[index + 1]]]
      : []
  ));
  const required = (name) => {
    if (!options[name]) throw new Error(`--${name} is required`);
    return options[name];
  };
  const mode = required("mode");
  if (!["smoke", "formal"].includes(mode)) {
    throw new Error("--mode must be smoke or formal");
  }
  const aliasInputMode = options["alias-input-mode"] ?? "observed";
  if (!["observed", "controlled-slot-switch"].includes(aliasInputMode)) {
    throw new Error(
      "--alias-input-mode must be observed or controlled-slot-switch",
    );
  }
  return {
    mode,
    aliasInputMode,
    manifest: required("manifest"),
    mossAudit: required("moss-audit"),
    sortformerUrl: required("sortformer-url"),
    aliasUrl: required("alias-url"),
    resolverModule: required("resolver-module"),
    similarityModule: required("similarity-module"),
    outputDir: required("output-dir"),
    sortformerApiKey: options["sortformer-api-key"],
    aliasApiKey: options["alias-api-key"],
    frameMs: Number(options["frame-ms"] ?? 500),
    segmentMs: Number(options["segment-ms"] ?? 1000),
    minDurationOnMs: Number(options["min-duration-on-ms"] ?? 0),
    minimumEvidenceMs: Number(options["minimum-evidence-ms"] ?? 1500),
    threshold: Number(options.threshold ?? 0.60),
  };
}

export function smokeRows(rows) {
  const far = rows.filter((row) => row.score_mode === "cer").slice(0, 4);
  const overlap = rows.find((row) => row.score_mode === "diagnostic_only");
  if (!overlap) throw new Error("smoke requires one overlap diagnostic");
  return [...far, overlap];
}

export function prepareAliasPipelineOutput(outputDir) {
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length > 0) {
    throw new Error(`output directory is not empty: ${outputDir}`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
}
