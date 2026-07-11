import 'dart:convert';

import 'package:flutter/foundation.dart';

void logCoreMlNemotronModelScan(
  String marker,
  Map<String, Object?> availabilityPayload,
) {
  debugPrint('$marker '
      '${jsonEncode(coreMlNemotronModelScanSummary(availabilityPayload))}');
}

void logCoreMlNemotronRuntimeAvailability(
  String marker,
  Map<String, Object?> availabilityPayload,
) {
  debugPrint('$marker '
      '${jsonEncode(coreMlNemotronRuntimeAvailabilitySummary(
    availabilityPayload,
  ))}');
}

Map<String, Object?> coreMlNemotronModelScanSummary(
  Map<String, Object?> availabilityPayload,
) {
  final modelScanValue = availabilityPayload['modelScan'];
  if (modelScanValue is! Map) {
    return const <String, Object?>{'available': false};
  }
  final modelScan = Map<String, Object?>.from(modelScanValue);
  return <String, Object?>{
    'available': true,
    'candidateCount': modelScan['candidateCount'],
    'selectedRoot': modelScan['selectedRoot'],
    'selectedStatus': modelScan['selectedStatus'],
    'selectedLayout': modelScan['selectedLayout'],
    'selectedMissing': modelScan['selectedMissing'] is List
        ? modelScan['selectedMissing']
        : const <Object?>[],
  };
}

Map<String, Object?> coreMlNemotronRuntimeAvailabilitySummary(
  Map<String, Object?> availabilityPayload,
) {
  final fluidAudio = _asMap(availabilityPayload['fluidAudio']);
  return <String, Object?>{
    'reason': availabilityPayload['reason'],
    'decoderReady': availabilityPayload['decoderReady'],
    'localModelReady': availabilityPayload['localModelReady'],
    'preparedModelReady': availabilityPayload['preparedModelReady'],
    'microphone': availabilityPayload['microphone'],
    'fluidAudio': <String, Object?>{
      'runtimeAvailable': fluidAudio['runtimeAvailable'],
      'prepared': fluidAudio['prepared'],
      'running': fluidAudio['running'],
      'processingError': fluidAudio['processingError'],
      'audio': fluidAudio['audio'],
      'endpoint': fluidAudio['endpoint'],
      'model': fluidAudio['model'],
    },
    'modelScan': coreMlNemotronModelScanSummary(availabilityPayload),
  };
}

String? coreMlNemotronStoppedAudioIssue(
  Map<String, Object?> availabilityPayload,
) {
  final fluidAudio = _asMap(availabilityPayload['fluidAudio']);
  final audio = _asMap(fluidAudio['audio']);
  final issues = <String>[];
  if (fluidAudio['running'] == true) {
    issues.add('fluidAudio.running=true');
  }
  if (audio['running'] == true) {
    issues.add('audio.running=true');
  }
  if (audio['tapInstalled'] == true) {
    issues.add('audio.tapInstalled=true');
  }
  if (audio['sessionActive'] == true) {
    issues.add('audio.sessionActive=true');
  }
  final sessionError = audio['sessionError'];
  if (sessionError is String && sessionError.trim().isNotEmpty) {
    issues.add('audio.sessionError=$sessionError');
  }
  if (issues.isEmpty) return null;
  return 'Device ASR audio resources were not fully released after stop: '
      '${issues.join(', ')}';
}

String? coreMlNemotronAudioCaptureIssue(
  Map<String, Object?> availabilityPayload,
) {
  final fluidAudio = _asMap(availabilityPayload['fluidAudio']);
  final audio = _asMap(fluidAudio['audio']);
  final processingError = fluidAudio['processingError'];
  if (processingError is String && processingError.trim().isNotEmpty) {
    return 'Device ASR processing failed: '
        'fluidAudio.processingError=${processingError.trim()}';
  }
  final sessionError = audio['sessionError'];
  if (sessionError is String && sessionError.trim().isNotEmpty) {
    return 'Device ASR audio session failed: '
        'audio.sessionError=${sessionError.trim()}';
  }
  final issues = <String>[];
  if (_asInt(audio['inputBuffers']) <= 0) {
    issues.add('audio.inputBuffers=0');
  }
  if (_asInt(audio['convertedSamples']) <= 0) {
    issues.add('audio.convertedSamples=0');
  }
  if (_asInt(audio['emittedChunks']) <= 0) {
    issues.add('audio.emittedChunks=0');
  }
  if (issues.isEmpty) return null;
  return 'Device ASR did not receive microphone audio: '
      '${issues.join(', ')}; audio=${jsonEncode(audio)}';
}

int _asInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return 0;
}

Map<String, Object?> _asMap(Object? value) {
  return value is Map ? Map<String, Object?>.from(value) : const {};
}
