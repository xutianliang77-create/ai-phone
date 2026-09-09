import 'public_creation_request_store.dart';

/// Checked response plus local request identity, never credentials or audio.
class PublicCreationResolution {
  PublicCreationResolution._(this.receipt, this.requestKey, this.scope,
      this.accountGeneration);
  final Map<String, Object?> receipt;
  final String requestKey, scope;
  final int accountGeneration;
  String get state => receipt['state']! as String;
  bool get terminal => const ['cancelled', 'expired'].contains(state);
  bool get canRetire => receipt['canRetire'] == true;

  static PublicCreationResolution checked(Map<String, Object?> value,
      {required String owner, required String deployment,
      required String key, required String scope, required int generation,
      required String nonce, required Object? body}) {
    final state = value['state'];
    final terminal = const ['cancelled', 'expired'].contains(state);
    final mutable = const ['not_found', 'prepared', 'issued', 'expired_pending'].contains(state);
    final sessionId = 'public-${publicCreationHash({
      'deploymentId': deployment, 'ownerId': owner, 'idempotencyKey': key})}';
    if (value.keys.any((k) => !const ['contractVersion', 'sessionId',
        'ownerId', 'deploymentId', 'nonce', 'requestHash', 'state',
        'safeToReplace', 'canRetire', 'expiresAt'].contains(k)) ||
        value['contractVersion'] != 1 || value['ownerId'] != owner ||
        value['deploymentId'] != deployment || value['sessionId'] != sessionId ||
        value['nonce'] != nonce || value['requestHash'] != publicCreationHash(body) ||
        (!terminal && !mutable && state != 'reconciliation_required') ||
        value['safeToReplace'] != terminal || value['canRetire'] != mutable ||
        (value.containsKey('expiresAt') &&
          (value['expiresAt'] is! String || DateTime.tryParse(value['expiresAt'] as String) == null))) {
      throw const FormatException('Public creation resolution binding mismatch');
    }
    return PublicCreationResolution._(Map.unmodifiable(value), key, scope, generation);
  }
}
