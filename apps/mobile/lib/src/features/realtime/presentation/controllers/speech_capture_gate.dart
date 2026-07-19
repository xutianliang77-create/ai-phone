import '../../../../platform/audio/audio_session_coordinator.dart';

class SpeechCaptureGate {
  SpeechCaptureGate({
    this.cooldown = const Duration(milliseconds: 350),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration cooldown;
  final DateTime Function() _now;
  AudioOutputRoute _route = AudioOutputRoute.speaker;
  bool _playbackActive = false;
  DateTime _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);
  String? _playbackText;
  String? _playbackLanguage;

  bool get requiresAcousticEchoSuppression =>
      _route.requiresAcousticEchoSuppression;
  bool get playbackActive => requiresAcousticEchoSuppression && _playbackActive;

  bool get blocksCapture {
    if (!requiresAcousticEchoSuppression) return false;
    return _playbackActive || _now().isBefore(_cooldownUntil);
  }

  void updateRoute(AudioOutputRoute route) {
    _route = route;
    if (!route.requiresAcousticEchoSuppression) {
      _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);
    }
  }

  bool shouldDropDeviceAsr({
    required String text,
    required String language,
  }) {
    if (!blocksCapture) return false;
    final playbackText = _playbackText;
    if (playbackText == null) return true;
    final playbackLanguage = _normalizedSpeechLanguage(
      _playbackLanguage ?? '',
    );
    final candidateLanguage = _normalizedSpeechLanguage(language) ??
        _dominantSpeechTextLanguage(text);
    if (playbackLanguage != null &&
        candidateLanguage != null &&
        playbackLanguage != candidateLanguage) {
      return false;
    }
    if (_isLikelySpeechEcho(playbackText, text)) return true;
    return playbackActive &&
        playbackLanguage != null &&
        playbackLanguage == candidateLanguage;
  }

  void beginPlayback({String? text, String? language}) {
    _playbackActive = true;
    _playbackText = text?.trim();
    _playbackLanguage = language;
  }

  void endPlayback() {
    _playbackActive = false;
    _cooldownUntil = _route.requiresAcousticEchoSuppression
        ? _now().add(cooldown)
        : DateTime.fromMillisecondsSinceEpoch(0);
  }

  void reset() {
    _playbackActive = false;
    _cooldownUntil = DateTime.fromMillisecondsSinceEpoch(0);
    _playbackText = null;
    _playbackLanguage = null;
  }
}

String? _normalizedSpeechLanguage(String language) {
  final normalized = language.trim().toLowerCase();
  if (normalized == 'zh' ||
      normalized.startsWith('zh-') ||
      normalized == 'cmn' ||
      normalized.startsWith('cmn-')) {
    return 'zh';
  }
  if (normalized == 'en' || normalized.startsWith('en-')) return 'en';
  return null;
}

String? _dominantSpeechTextLanguage(String text) {
  final zh = RegExp(r'[\u4e00-\u9fff]').allMatches(text).length;
  final en = RegExp(r'[A-Za-z]').allMatches(text).length;
  if (zh == 0 && en == 0) return null;
  return zh >= en ? 'zh' : 'en';
}

bool _isLikelySpeechEcho(String reference, String candidate) {
  final normalizedReference = _normalizedEchoText(reference);
  final normalizedCandidate = _normalizedEchoText(candidate);
  if (normalizedReference.isEmpty || normalizedCandidate.isEmpty) return false;
  if (normalizedReference == normalizedCandidate) return true;

  final referenceCompact = normalizedReference.replaceAll(' ', '');
  final candidateCompact = normalizedCandidate.replaceAll(' ', '');
  final referenceIsShorter = referenceCompact.length <= candidateCompact.length;
  final shorter = referenceIsShorter ? referenceCompact : candidateCompact;
  final longer = referenceIsShorter ? candidateCompact : referenceCompact;
  if (shorter.length >= 3 &&
      longer.contains(shorter) &&
      shorter.length / longer.length >= 0.3) {
    return true;
  }

  final referenceTokens = normalizedReference.split(' ').toSet();
  final candidateTokens = normalizedCandidate.split(' ').toSet();
  final tokenOverlap = referenceTokens.intersection(candidateTokens).length;
  if (candidateTokens.length >= 2 &&
      tokenOverlap / candidateTokens.length >= 0.6) {
    return true;
  }

  final referenceBigrams = _echoBigrams(referenceCompact);
  final candidateBigrams = _echoBigrams(candidateCompact);
  if (referenceBigrams.isEmpty || candidateBigrams.isEmpty) return false;
  final overlap = referenceBigrams.intersection(candidateBigrams).length;
  final dice =
      (2 * overlap) / (referenceBigrams.length + candidateBigrams.length);
  return dice >= 0.55;
}

String _normalizedEchoText(String text) {
  return text
      .toLowerCase()
      .replaceAll(RegExp(r'[^a-z0-9\u4e00-\u9fff]+'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

Set<String> _echoBigrams(String text) {
  if (text.length < 2) return const <String>{};
  return <String>{
    for (var index = 0; index < text.length - 1; index += 1)
      text.substring(index, index + 2),
  };
}
