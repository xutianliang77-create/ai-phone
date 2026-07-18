import type {
  RealtimeNodeDiagnosticsDto,
  RealtimeSessionDiagnosticsDto,
} from "@translation/contracts";

const MAX_NODE_RUNTIMES = 16;

export function mergeSessionNodeDiagnostics(
  current: RealtimeSessionDiagnosticsDto | undefined,
  node: RealtimeNodeDiagnosticsDto,
): RealtimeSessionDiagnosticsDto {
  const nodes = [...(current?.nodes ?? []).filter(
    (item) => item.runtimeId !== node.runtimeId,
  ), node]
    .sort((left, right) => left.startedAtMs - right.startedAtMs ||
      left.runtimeId.localeCompare(right.runtimeId))
    .slice(-MAX_NODE_RUNTIMES);
  return {
    version: 1,
    audio: aggregateAudio(nodes),
    ...(current?.speakerTurns ? { speakerTurns: current.speakerTurns } : {}),
    ...(current?.vad ? { vad: current.vad } : {}),
    nodes,
  };
}

function aggregateAudio(nodes: RealtimeNodeDiagnosticsDto[]) {
  let receivedFrameCount = 0;
  let processedBatchCount = 0;
  let droppedFrameCount = 0;
  for (const node of nodes) {
    for (const leg of node.audioLegs) {
      receivedFrameCount = safeAdd(receivedFrameCount, leg.receivedFrames);
      processedBatchCount = safeAdd(processedBatchCount, leg.processedFrames);
      droppedFrameCount = safeAdd(droppedFrameCount, leg.droppedFrames);
    }
  }
  return { receivedFrameCount, processedBatchCount, droppedFrameCount };
}

function safeAdd(left: number, right: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
