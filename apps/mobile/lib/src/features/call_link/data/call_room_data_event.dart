import 'dart:convert';

import 'call_room_client.dart';
import '../../../shared/domain/speaker_attribution.dart';

class CallRoomDataPayload {
  const CallRoomDataPayload({
    this.message,
    this.caption,
    this.duplexMode,
    this.degradationReason,
    this.eventType,
    this.conversationState,
    this.playbackState,
    this.playbackId,
    this.generation,
    this.pipelineGeneration,
    this.speakerRole,
  });

  final String? message;
  final CallRoomCaption? caption;
  final String? duplexMode;
  final String? degradationReason;
  final String? eventType;
  final CallRoomConversationState? conversationState;
  final CallRoomPlaybackState? playbackState;
  final String? playbackId;
  final int? generation;
  final int? pipelineGeneration;
  final String? speakerRole;
}

CallRoomDataPayload parseCallRoomData(
  List<int> data, {
  String? expectedCallId,
  String? expectedRoomName,
}) {
  try {
    final decoded = utf8.decode(data);
    final payload = jsonDecode(decoded);
    if (payload is! Map<String, Object?>) {
      return const CallRoomDataPayload();
    }
    if (!_matchesCallRoom(
      payload,
      expectedCallId: expectedCallId,
      expectedRoomName: expectedRoomName,
    )) {
      return const CallRoomDataPayload();
    }
    final type = payload['type'] as String?;
    final text = _string(payload['text']);
    final eventType = type;
    final playbackId = _string(payload['playbackId']);
    final generation = _int(payload['generation']);
    final pipelineGeneration = _int(payload['pipelineGeneration']);
    final speakerRole = _string(payload['speakerRole']);
    if (type == 'worker.status') {
      return CallRoomDataPayload(
        message: _workerStatusMessage(payload, text),
        conversationState: _workerConversationState(payload),
        eventType: eventType,
        playbackId: playbackId,
        generation: generation,
        pipelineGeneration: pipelineGeneration,
        speakerRole: speakerRole,
      );
    }
    if (type == 'agent.thinking') {
      return CallRoomDataPayload(
        message: text ?? 'AI 正在思考',
        conversationState: CallRoomConversationState.thinking,
        eventType: eventType,
        playbackId: playbackId,
        generation: generation,
        pipelineGeneration: pipelineGeneration,
        speakerRole: speakerRole,
      );
    }
    if (type == 'pipeline.degraded' || type == 'pipeline.restored') {
      final degraded = type == 'pipeline.degraded';
      return CallRoomDataPayload(
        message: degraded ? '全双工抢话已降级为半双工' : '全双工抢话已恢复',
        duplexMode: degraded ? 'half_duplex' : 'full_duplex',
        degradationReason: _string(payload['degradationReason']),
        conversationState: degraded
            ? CallRoomConversationState.listening
            : CallRoomConversationState.idle,
        eventType: eventType,
        playbackId: playbackId,
        generation: generation,
        pipelineGeneration: pipelineGeneration,
        speakerRole: speakerRole,
      );
    }
    if (type == 'transcript.partial' ||
        type == 'transcript.final' ||
        type == 'translation.delta' ||
        type == 'translation.final' ||
        type == 'tts.ready') {
      final caption = _captionFromPayload(payload, type!);
      if (caption.sourceText == null &&
          caption.translatedText == null &&
          !caption.ttsReady) {
        return const CallRoomDataPayload();
      }
      return CallRoomDataPayload(
        caption: caption,
        conversationState: type == 'transcript.partial'
            ? CallRoomConversationState.listening
            : type == 'translation.delta'
                ? CallRoomConversationState.thinking
                : null,
        eventType: eventType,
        playbackId: playbackId,
        generation: generation,
        pipelineGeneration: pipelineGeneration,
        speakerRole: speakerRole,
      );
    }
    if (type == 'playback.queued' ||
        type == 'playback.started' ||
        type == 'playback.interrupted' ||
        type == 'playback.ended' ||
        type == 'playback.failed' ||
        type == 'barge_in.detected' ||
        type == 'barge_in.confirmed') {
      final playbackState = _playbackState(type);
      return CallRoomDataPayload(
        message: _playbackMessage(type!) ?? '通话音频状态更新',
        conversationState: type == 'playback.started'
            ? CallRoomConversationState.speaking
            : type == 'barge_in.detected' || type == 'barge_in.confirmed'
                ? CallRoomConversationState.interrupted
                : playbackState == CallRoomPlaybackState.ended ||
                        playbackState == CallRoomPlaybackState.interrupted ||
                        playbackState == CallRoomPlaybackState.failed
                    ? CallRoomConversationState.listening
                    : null,
        playbackState: playbackState,
        eventType: eventType,
        playbackId: playbackId,
        generation: generation,
        pipelineGeneration: pipelineGeneration,
        speakerRole: speakerRole,
      );
    }
    return const CallRoomDataPayload();
  } catch (_) {
    return const CallRoomDataPayload();
  }
}

bool _matchesCallRoom(
  Map<String, Object?> payload, {
  required String? expectedCallId,
  required String? expectedRoomName,
}) {
  if (expectedCallId != null && payload['callId'] != expectedCallId) {
    return false;
  }
  if (expectedRoomName != null && payload['roomName'] != expectedRoomName) {
    return false;
  }
  return true;
}

CallRoomCaption _captionFromPayload(
  Map<String, Object?> payload,
  String type,
) {
  final text = _cleanText(_string(payload['text']));
  final sourceText = _cleanText(_string(payload['sourceText']));
  final translatedText = _cleanText(_string(payload['translatedText']));
  final speakerJson = payload['speaker'];
  final speakerRole = _string(payload['speakerRole']) ?? 'guest';
  final speaker = speakerJson is Map
      ? SpeakerAttribution.fromJson(
          Map<String, Object?>.from(speakerJson),
        )
      : SpeakerAttribution(
          speakerId: speakerRole,
          role: speakerRole,
          source: 'participant_track',
          confidence: 1,
        );
  return CallRoomCaption(
    segmentId: _string(payload['segmentId']) ?? '${payload['timestampMs']}',
    speaker: speaker,
    sourceLanguage: _string(payload['sourceLanguage']) ?? 'auto',
    targetLanguage: _string(payload['targetLanguage']) ?? 'auto',
    timestampMs:
        _int(payload['timestampMs']) ?? DateTime.now().millisecondsSinceEpoch,
    sourceText: type == 'transcript.final' || type == 'transcript.partial'
        ? sourceText ?? text
        : sourceText,
    translatedText: type == 'translation.final' ||
            type == 'translation.delta' ||
            type == 'tts.ready'
        ? translatedText ?? text
        : translatedText,
    ttsReady: type == 'tts.ready',
    ttsProvider: _string(payload['provider']),
    ttsModel: _string(payload['model']),
    voiceMode: _string(payload['voiceMode']),
    voiceProfileId: _string(payload['voiceProfileId']),
    firstAudioMs: _int(payload['firstAudioMs']),
    audioDurationMs: _int(payload['audioDurationMs']),
    isPartial: type == 'transcript.partial',
    isTranslationDelta: type == 'translation.delta',
    playbackState: _playbackState(type),
    playbackId: _string(payload['playbackId']),
    generation: _int(payload['generation']),
  );
}

CallRoomConversationState? _workerConversationState(
  Map<String, Object?> payload,
) {
  return switch (_string(payload['stage'])) {
    'asr' => CallRoomConversationState.listening,
    'translation' || 'tts' => CallRoomConversationState.thinking,
    _ => null,
  };
}

CallRoomPlaybackState _playbackState(String? type) {
  return switch (type) {
    'playback.queued' => CallRoomPlaybackState.queued,
    'playback.started' => CallRoomPlaybackState.started,
    'playback.interrupted' ||
    'barge_in.detected' ||
    'barge_in.confirmed' =>
      CallRoomPlaybackState.interrupted,
    'playback.ended' => CallRoomPlaybackState.ended,
    'playback.failed' => CallRoomPlaybackState.failed,
    _ => CallRoomPlaybackState.idle,
  };
}

String? _playbackMessage(String type) {
  return switch (type) {
    'playback.queued' => '译音已排队',
    'playback.started' => '正在播放译音',
    'playback.ended' => '译音播放完成',
    'playback.interrupted' => '译音已中断',
    'playback.failed' => '译音播放失败',
    'barge_in.detected' => '检测到抢话，正在停止译音',
    'barge_in.confirmed' => '已停止译音，恢复监听',
    _ => null,
  };
}

String? _workerStatusMessage(Map<String, Object?> payload, String? fallback) {
  final text = fallback ?? '状态更新';
  final stage = _string(payload['stage']);
  final stageLabel = switch (stage) {
    'asr' => 'ASR',
    'translation' => '翻译',
    'tts' => 'TTS',
    'worker' => '通话 Worker',
    _ => null,
  };
  final meta = [
    _string(payload['provider']),
    _string(payload['model']),
    if (_bool(payload['retryable']) == true) '可重试',
  ].whereType<String>().join('，');
  final body = stageLabel == null ? text : '$stageLabel：$text';
  return meta.isEmpty ? body : '$body（$meta）';
}

String? _string(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

int? _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return null;
}

bool? _bool(Object? value) {
  return value is bool ? value : null;
}

String? _cleanText(String? text) {
  final collapsed = text?.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (collapsed == null || collapsed.isEmpty) return null;
  final compact = collapsed
      .toLowerCase()
      .replaceAll(RegExp(r'[\s,，.。!！?？;；:：、\-_\/]+'), '')
      .replaceAll(
        RegExp(r'(?:<|\[|\()(?:sil|noise|blank|unk)(?:>|\]|\))'),
        '',
      );
  return compact.isEmpty ? null : collapsed;
}
