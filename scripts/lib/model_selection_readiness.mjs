import { existsSync, readFileSync } from "node:fs";

const REQUIRED_DOMAINS = ["asr", "translation", "tts"];
const REQUIRED_MODEL_EVAL_GROUPS = [
  "zh_meeting",
  "en_short",
  "code_switch",
  "terms_numbers",
  "tts_phone",
];

export function checkModelSelectionReadiness(filePath) {
  const checks = [];
  const issues = [];
  const actions = [];

  if (!filePath || !existsSync(filePath)) {
    record(checks, "model_selection_report_exists", false, { filePath });
    issues.push("Model selection report is required before domestic release.");
    actions.push("Create release/domestic/model-selection-report.json from real model-eval outputs.");
    return result(filePath, checks, issues, actions);
  }

  record(checks, "model_selection_report_exists", true, { filePath });
  const report = parseReport(filePath, checks, issues);
  if (!report) return result(filePath, checks, issues, actions);

  checkReportStatus(report, checks, issues);
  checkDomains(report, checks, issues);
  checkModelEvalEvidence(report, checks, issues);
  checkRiskReviews(report, checks, issues);
  if (issues.length > 0) {
    actions.push("Complete ASR, translation, and TTS model selection using model-eval evidence.");
  }
  return result(filePath, checks, issues, actions);
}

export function appendModelSelectionReadiness(context) {
  if (!context.enabled) {
    context.record(context.checks, "model_selection_readiness", true, { skipped: true });
    return;
  }
  const result = (context.checkFn ?? checkModelSelectionReadiness)(context.filePath);
  const ready = result.status === "ready";
  context.record(context.checks, "model_selection_readiness", ready, {
    status: result.status,
    filePath: result.filePath,
    checks: result.checks,
  });
  if (!ready) {
    context.issues.push("model_selection_readiness is not ready.");
    context.issues.push(...normalizeIssues(result.issues));
    context.actions.push(...(result.actions ?? []));
  }
}

function parseReport(filePath, checks, issues) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    record(checks, "model_selection_report_json", false, { message: errorMessage(error) });
    issues.push(`Model selection report is not valid JSON: ${errorMessage(error)}`);
    return null;
  }
}

function checkReportStatus(report, checks, issues) {
  const ready = report.status === "selected" && Boolean(report.decidedAt);
  record(checks, "model_selection_status", ready, {
    status: report.status,
    decidedAt: report.decidedAt,
  });
  if (!ready) issues.push("Model selection report must have status=selected and decidedAt.");
}

function checkDomains(report, checks, issues) {
  for (const domain of REQUIRED_DOMAINS) {
    const section = report[domain] ?? {};
    const ready = ["default", "gray", "fallback"].every((key) =>
      hasModelChoice(section[key])
    );
    record(checks, `model_selection_${domain}_choices`, ready, {
      default: summarizeChoice(section.default),
      gray: summarizeChoice(section.gray),
      fallback: summarizeChoice(section.fallback),
    });
    if (!ready) {
      issues.push(`Model selection report must include ${domain} default, gray, and fallback choices.`);
    }
  }
}

function checkModelEvalEvidence(report, checks, issues) {
  const evidence = report.modelEval ?? {};
  const groups = Array.isArray(evidence.requiredGroups) ? evidence.requiredGroups : [];
  const missingGroups = REQUIRED_MODEL_EVAL_GROUPS.filter((group) => !groups.includes(group));
  const ready = evidence.status === "ready" &&
    Boolean(evidence.fixture) &&
    missingGroups.length === 0;
  record(checks, "model_selection_model_eval_evidence", ready, {
    status: evidence.status,
    fixture: evidence.fixture,
    missingGroups,
  });
  if (!ready) {
    issues.push("Model selection report must reference ready model-eval evidence with all required groups.");
  }
}

function checkRiskReviews(report, checks, issues) {
  const risks = report.risks ?? {};
  const ready = risks.licensingReviewed === true &&
    risks.costReviewed === true &&
    risks.deploymentReviewed === true;
  record(checks, "model_selection_risk_reviews", ready, risks);
  if (!ready) {
    issues.push("Model selection report must confirm licensing, cost, and deployment reviews.");
  }
}

function hasModelChoice(value) {
  return Boolean(value?.provider && value?.model);
}

function summarizeChoice(value = {}) {
  return value.provider && value.model ? `${value.provider}/${value.model}` : null;
}

function result(filePath, checks, issues, actions) {
  return {
    schemaVersion: 1,
    status: issues.length === 0 ? "ready" : "not_ready",
    filePath: filePath || null,
    checks,
    issues,
    actions: [...new Set(actions)],
  };
}

function record(checks, name, ok, details = {}) {
  checks.push({ name, status: ok ? "pass" : "fail", details });
}

function normalizeIssues(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string" && item.length > 0)
    : [];
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
