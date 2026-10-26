/// Text remains in the transcript. This class budgets only automatic playback.
class SpeechBacklogPolicy {
  SpeechBacklogPolicy({int Function()? nowMs})
    : _nowMs = nowMs ?? (() => _watch.elapsedMilliseconds);

  static final _watch = Stopwatch()..start();
  static const warningMs = 4000;
  static const maximumWaitMs = 8000;
  final int Function() _nowMs;
  final Map<int, _QueuedSpeech> _pending = {};
  final Map<String, double> _millisecondsPerUnit = {};
  int _serial = 0;
  _QueuedSpeech? _active;
  int? _activeId;
  int _activeStarted = 0;
  bool paused = false;
  int interruptionEpoch = 0;
  int lastAdmissionWaitMs = 0;
  int get pendingCount => _pending.length;
  int? get nextExpiryMs {
    if (_pending.isEmpty || paused) return null;
    final oldest = _pending.values
        .map((p) => p.enqueuedMs)
        .reduce((a, b) => a < b ? a : b);
    return (maximumWaitMs + 1 - (_nowMs() - oldest)).clamp(
      0,
      maximumWaitMs + 1,
    );
  }

  bool pauseExpired() {
    if (nextExpiryMs != 0) return false;
    pause();
    return true;
  }

  int get estimatedWaitMs {
    final active = _active;
    final remaining = active == null
        ? 0
        : (active.estimateMs - (_nowMs() - _activeStarted)).clamp(
            0,
            active.estimateMs,
          );
    return remaining + _pending.values.fold(0, (n, p) => n + p.estimateMs);
  }

  int? enqueue(String text, String language) {
    if (paused) return null;
    lastAdmissionWaitMs = estimatedWaitMs;
    if (lastAdmissionWaitMs > maximumWaitMs || _pending.length >= 32) {
      pause();
      return null;
    }
    final id = ++_serial;
    final units = _units(text, language);
    final estimate =
        (units *
                (_millisecondsPerUnit[language] ??
                    (language.startsWith('zh') ? 240 : 430)))
            .round()
            .clamp(300, 120000);
    _pending[id] = _QueuedSpeech(_nowMs(), estimate, units, language);
    return id;
  }

  bool begin(int id) {
    final item = _pending.remove(id);
    if (item == null || paused) return false;
    if (_nowMs() - item.enqueuedMs > maximumWaitMs) {
      pause();
      return false;
    }
    _active = item;
    _activeId = id;
    _activeStarted = _nowMs();
    return true;
  }

  void finish(int id, {double? speakingMs}) {
    if (_activeId != id) return;
    final active = _active;
    if (active != null &&
        speakingMs != null &&
        speakingMs.isFinite &&
        speakingMs > 0 &&
        active.units > 0) {
      final measured = (speakingMs / active.units).clamp(40.0, 1500.0);
      final old = _millisecondsPerUnit[active.language] ?? measured;
      _millisecondsPerUnit[active.language] = old * 0.75 + measured * 0.25;
    }
    _active = null;
    _activeId = null;
  }

  void pause() {
    if (!paused) interruptionEpoch++;
    paused = true;
    _pending.clear();
  }

  void resume() {
    paused = false;
    _pending.clear();
  }

  void clear() {
    interruptionEpoch++;
    _pending.clear();
    _active = null;
    _activeId = null;
    paused = false;
  }

  void discard(int id) => _pending.remove(id);

  static int _units(String text, String language) => language.startsWith('zh')
      ? text.runes
            .where((r) => !RegExp(r'\s').hasMatch(String.fromCharCode(r)))
            .length
      : text.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty).length;
}

class _QueuedSpeech {
  _QueuedSpeech(this.enqueuedMs, this.estimateMs, this.units, this.language);
  final int enqueuedMs, estimateMs, units;
  final String language;
}

/// Split only at existing punctuation. Decimal numbers and unpunctuated words
/// remain intact; no text is summarized or discarded to satisfy a duration cap.
List<String> speechPlaybackChunks(String text) {
  final chunks = <String>[];
  var start = 0;
  final boundary = RegExp(r'[。！？；，!?;]|\.(?=\s|$)|,(?=\s)');
  for (final match in boundary.allMatches(text)) {
    final chunk = text.substring(start, match.end).trim();
    if (chunk.isNotEmpty) chunks.add(chunk);
    start = match.end;
  }
  final tail = text.substring(start).trim();
  if (tail.isNotEmpty) chunks.add(tail);
  return chunks;
}
