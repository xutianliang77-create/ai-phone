class CallRoomTtsCaptureGate {
  CallRoomTtsCaptureGate({
    this.cooldown = const Duration(milliseconds: 500),
    DateTime Function()? now,
  }) : _now = now ?? DateTime.now;

  final Duration cooldown;
  final DateTime Function() _now;
  DateTime _blockedUntil = DateTime.fromMillisecondsSinceEpoch(0);

  Duration blockFor(Duration playback) {
    final now = _now();
    final queuedAudioEnd =
        _blockedUntil.isAfter(now) ? _blockedUntil.subtract(cooldown) : now;
    final start = queuedAudioEnd.isAfter(now) ? queuedAudioEnd : now;
    _blockedUntil = start.add(playback).add(cooldown);
    return remaining;
  }

  Duration holdCooldown() {
    final now = _now();
    final minimum = now.add(cooldown);
    if (_blockedUntil.isBefore(minimum)) _blockedUntil = minimum;
    return remaining;
  }

  Duration get remaining {
    final value = _blockedUntil.difference(_now());
    return value.isNegative ? Duration.zero : value;
  }

  void reset() {
    _blockedUntil = DateTime.fromMillisecondsSinceEpoch(0);
  }
}
