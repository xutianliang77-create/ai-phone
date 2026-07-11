import { iosNemotronRequiredRuntimeContract as contract } from "./ios_nemotron_runtime_contract.mjs";

export function smokeStructuredResultIssues(results) {
  return (results ?? []).flatMap((result) => {
    if (!result.found || !result.summary) {
      return [`structured smoke result is missing: ${result.marker}`];
    }
    if (result.marker === "COREML_NEMOTRON_SELF_TEST_RESULT") {
      return selfTestIssues(result.summary);
    }
    if (result.marker === "COREML_NEMOTRON_GATEWAY_E2E_RESULT") {
      return gatewayE2eIssues(result.summary);
    }
    if (result.marker === "COREML_NEMOTRON_LOCAL_MVP_RESULT") {
      return localMvpIssues(result.summary);
    }
    return [`unknown structured smoke result marker: ${result.marker}`];
  });
}

function selfTestIssues(summary) {
  const issues = commonRunIssues("self-test", summary);
  if (summary.expectSegment !== false) {
    issues.push(...deviceAsrConfigIssues("self-test", summary));
    if (!positiveNumber(summary.segmentCount)) {
      issues.push("self-test emitted no ASR segments");
    }
    const charCounts = Array.isArray(summary.receivedCharCounts)
      ? summary.receivedCharCounts
      : [];
    if (!charCounts.some((count) => Number(count) > 0)) {
      issues.push("self-test emitted no non-empty ASR text");
    }
  }
  return issues;
}

function gatewayE2eIssues(summary) {
  const issues = commonRunIssues("Gateway e2e", summary);
  if (summary.apiHealthOk !== true) issues.push("Gateway e2e API health failed");
  if (summary.asrSendStarted !== true) {
    issues.push("Gateway e2e did not start ASR text send");
  }
  if (summary.asrSent !== true) issues.push("Gateway e2e ASR text was not sent");
  if (summary.expectTranslation !== false) {
    issues.push(...deviceAsrConfigIssues("Gateway e2e", summary));
    if (summary.sourceLanguage !== contract.sourceLanguage) {
      issues.push(
        `Gateway e2e source language was not ${contract.sourceLanguage}: ${summary.sourceLanguage ?? "missing"}`,
      );
    }
    if (summary.targetLanguage !== contract.targetLanguage) {
      issues.push(
        `Gateway e2e target language was not ${contract.targetLanguage}: ${summary.targetLanguage ?? "missing"}`,
      );
    }
    if (summary.gatewayProvider !== contract.gatewayProvider) {
      issues.push(
        `Gateway e2e provider was not ${contract.gatewayProvider}: ${summary.gatewayProvider ?? "missing"}`,
      );
    }
    if (summary.gatewayAsrProvider !== contract.gatewayAsrProvider) {
      issues.push(
        `Gateway e2e ASR provider was not ${contract.gatewayAsrProvider}: ${summary.gatewayAsrProvider ?? "missing"}`,
      );
    }
    if (summary.translationFinal !== true) {
      issues.push("Gateway e2e translation.final was not received");
    }
    if (summary.historyDetailLoaded !== true) {
      issues.push("Gateway e2e history detail was not loaded");
    }
    if (summary.historySaved !== true) {
      issues.push("Gateway e2e history was not saved");
    }
    if (summary.serverOwnedHistory !== false && summary.historyStatus !== "ended") {
      issues.push("Gateway e2e server-owned history did not end");
    }
    if (
      summary.serverOwnedHistory !== false &&
      summary.gatewaySessionEventSink !== contract.gatewaySessionEventSink
    ) {
      issues.push(
        `Gateway e2e session event sink was not ${contract.gatewaySessionEventSink}: ${summary.gatewaySessionEventSink ?? "missing"}`,
      );
    }
  }
  return issues;
}

function localMvpIssues(summary) {
  const issues = commonRunIssues("local MVP", summary);
  if (summary.expectTranslation !== false) {
    issues.push(...deviceAsrConfigIssues("local MVP", summary));
    if (summary.sourceLanguage !== contract.sourceLanguage) {
      issues.push(
        `local MVP source language was not ${contract.sourceLanguage}: ${summary.sourceLanguage ?? "missing"}`,
      );
    }
    if (summary.targetLanguage !== contract.targetLanguage) {
      issues.push(
        `local MVP target language was not ${contract.targetLanguage}: ${summary.targetLanguage ?? "missing"}`,
      );
    }
    if (summary.useLocalSessions !== contract.useLocalSessions) {
      issues.push("local MVP did not use local sessions");
    }
    if (summary.useOnDeviceTranslation !== contract.useOnDeviceTranslation) {
      issues.push("local MVP did not enable on-device translation");
    }
    if (summary.onDeviceTranslationProvider !== contract.onDeviceTranslationProvider) {
      issues.push(
        `local MVP translation provider was not ${contract.onDeviceTranslationProvider}: ${summary.onDeviceTranslationProvider ?? "missing"}`,
      );
    }
    if (summary.onDeviceTranslationRequired !== contract.onDeviceTranslationRequired) {
      issues.push("local MVP translation required flag did not match contract");
    }
    if (summary.translationProvider !== contract.onDeviceTranslationProvider) {
      issues.push(
        `local MVP translation availability provider was not ${contract.onDeviceTranslationProvider}: ${summary.translationProvider ?? "missing"}`,
      );
    }
    if (summary.translationAvailable !== true) {
      issues.push(
        `local MVP on-device translation was not available: ${summary.translationReason ?? "missing"}`,
      );
    }
    if (summary.translationFinal !== true) {
      issues.push("local MVP on-device translation was not produced");
    }
    if (summary.historyDetailLoaded !== true) {
      issues.push("local MVP history detail was not loaded");
    }
    if (summary.localHistorySaved !== true) {
      issues.push("local MVP history was not saved");
    }
    if (summary.localExportReady !== true) {
      issues.push("local MVP Markdown export was not ready");
    }
    if (summary.historyStatus !== "ended") {
      issues.push("local MVP local history did not end");
    }
  }
  return issues;
}

function deviceAsrConfigIssues(label, summary) {
  const issues = [];
  if (summary.deviceAsrProvider !== contract.deviceAsrProvider) {
    issues.push(
      `${label} device ASR provider was not ${contract.deviceAsrProvider}: ${summary.deviceAsrProvider ?? "missing"}`,
    );
  }
  if (summary.modelChunkMs !== contract.modelChunkMs) {
    issues.push(
      `${label} Nemotron model chunk was not ${contract.modelChunkMs}ms: ${summary.modelChunkMs ?? "missing"}`,
    );
  }
  if (summary.autoDownloadModel !== contract.autoDownloadModel) {
    issues.push(
      `${label} did not use staged Nemotron model: autoDownloadModel=${summary.autoDownloadModel ?? "missing"}`,
    );
  }
  issues.push(...coreMlRuntimeIssues(label, summary));
  return issues;
}

function coreMlRuntimeIssues(label, summary) {
  const issues = [];
  if (summary.fluidAudioRuntimeAvailableAfterStart !== true) {
    issues.push(`${label} FluidAudio runtime was not available after start`);
  }
  if (summary.decoderReadyAfterStart !== true) {
    issues.push(`${label} Core ML decoder was not ready after start`);
  }
  if (
    summary.preparedModelReadyAfterStart !== true &&
    summary.fluidAudioPreparedAfterStart !== true
  ) {
    issues.push(`${label} Nemotron model was not prepared after start`);
  }
  if (summary.modelScanStatusAfterStart !== "ready") {
    issues.push(
      `${label} staged Nemotron model was not ready after start: ${summary.modelScanStatusAfterStart ?? "missing"}`,
    );
  }
  if (!["fluid_split_fused", "split_encoder_decoder_joint"].includes(
    summary.modelScanLayoutAfterStart,
  )) {
    issues.push(
      `${label} Nemotron model layout was not recognized after start: ${summary.modelScanLayoutAfterStart ?? "missing"}`,
    );
  }
  return issues;
}

function commonRunIssues(label, summary) {
  const issues = [];
  if (summary.canStart !== true) issues.push(`${label} ASR could not start`);
  for (const key of [
    "error",
    "stopError",
    "endError",
    "asrSendError",
    "translationError",
    "historyError",
    "audioCaptureError",
    "audioProcessingError",
    "apiHealthError",
  ]) {
    if (summary[key]) issues.push(`${label} reported ${key}: ${summary[key]}`);
  }
  return issues;
}

function positiveNumber(value) {
  return Number(value) > 0;
}
