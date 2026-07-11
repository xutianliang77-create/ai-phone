import 'dart:convert';

import 'call_room_client.dart';
import '../../../shared/domain/speaker_attribution.dart';

class CallRoomDataPayload {
  const CallRoomDataPayload({this.message, this.caption});

  final String? message;
  final CallRoomCaption? caption;
}

CallRoomDataPayload parseCallRoomData(List<int> data) {
  try {
    final decoded = utf8.decode(data);
    final payload = jsonDecode(decoded);
    if (payload is! Map<String, Object?>) {
      return CallRoomDataPayload(message: decoded);
    }
    final type = payload['type'] as String?;
    final text = _string(payload['text']);
    if (type == 'worker.status') {
      return CallRoomDataPayload(
        message: _workerStatusMessage(payload, text),
      );
    }
    if (type == 'transcript.final' ||
        type == 'translation.final' ||
        type == 'tts.ready') {
      final caption = _captionFromPayload(payload, type!);
      if (caption.sourceText == null &&
          caption.translatedText == null &&
          !caption.ttsReady) {
        return const CallRoomDataPayload();
      }
      return CallRoomDataPayload(caption: caption);
    }
    return CallRoomDataPayload(message: _cleanText(text) ?? decoded);
  } catch (_) {
    return const CallRoomDataPayload(message: 'LiveKit data message');
  }
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
    sourceText: type == 'transcript.final' ? sourceText ?? text : sourceText,
    translatedText: type == 'translation.final' || type == 'tts.ready'
        ? translatedText ?? text
        : translatedText,
    ttsReady: type == 'tts.ready',
    ttsProvider: _string(payload['provider']),
    ttsModel: _string(payload['model']),
    voiceMode: _string(payload['voiceMode']),
    voiceProfileId: _string(payload['voiceProfileId']),
    firstAudioMs: _int(payload['firstAudioMs']),
    audioDurationMs: _int(payload['audioDurationMs']),
  );
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
