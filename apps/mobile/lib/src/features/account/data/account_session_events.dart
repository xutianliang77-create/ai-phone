import 'dart:async';

/// In-process invalidation only; no credential or content is carried in events.
class AccountSessionEvents {
  static final _changes = StreamController<void>.broadcast();
  static Stream<void> get changes => _changes.stream;
  static void changed() => _changes.add(null);
}
