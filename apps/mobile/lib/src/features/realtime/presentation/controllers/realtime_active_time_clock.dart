import 'realtime_session_state.dart';

class RealtimeActiveTimeClock {
  RealtimeActiveTimeClock({DateTime Function()? now})
      : _now = now ?? DateTime.now;

  final DateTime Function() _now;
  Duration _accumulated = Duration.zero;
  DateTime? _activeSince;

  int get billableSeconds {
    final current =
        _activeSince == null ? Duration.zero : _now().difference(_activeSince!);
    final milliseconds = (_accumulated + current).inMilliseconds;
    return milliseconds <= 0 ? 0 : (milliseconds / 1000).ceil();
  }

  void reset() {
    _accumulated = Duration.zero;
    _activeSince = null;
  }

  void transition(RealtimeStatus previous, RealtimeStatus next) {
    if (previous == next) return;
    final now = _now();
    if (previous == RealtimeStatus.active && _activeSince != null) {
      _accumulated += now.difference(_activeSince!);
      _activeSince = null;
    }
    if (next == RealtimeStatus.active) _activeSince = now;
  }
}
