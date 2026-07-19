import 'dart:ui';

import '../../../app/app_config.dart';
import '../../account/data/account_api_client.dart';
import '../../account/data/account_session_store.dart';

abstract class ConsentAuditUploader {
  Future<void> record({
    required String consentType,
    required String version,
    required String scene,
    required Locale locale,
    String? acceptedAtIso,
  });
}

class AccountConsentAuditUploader implements ConsentAuditUploader {
  AccountConsentAuditUploader({
    required AccountApiClient accountApiClient,
    required AccountSessionStore accountSessionStore,
  })  : _accountApiClient = accountApiClient,
        _accountSessionStore = accountSessionStore;

  factory AccountConsentAuditUploader.fromEnvironment() {
    return AccountConsentAuditUploader(
      accountApiClient: AccountApiClient(
        baseUrl: AppConfig.fromEnvironment().apiBaseUrl,
      ),
      accountSessionStore: const FileAccountSessionStore(),
    );
  }

  final AccountApiClient _accountApiClient;
  final AccountSessionStore _accountSessionStore;

  @override
  Future<void> record({
    required String consentType,
    required String version,
    required String scene,
    required Locale locale,
    String? acceptedAtIso,
  }) async {
    try {
      final session = await _accountSessionStore.load();
      if (session == null) return;
      await _accountApiClient.recordConsent(
        token: session.token,
        consentType: consentType,
        version: version,
        scene: scene,
        acceptedAtIso:
            acceptedAtIso ?? DateTime.now().toUtc().toIso8601String(),
        locale: locale.languageCode,
      );
    } catch (_) {
      return;
    }
  }
}

class NoopConsentAuditUploader implements ConsentAuditUploader {
  const NoopConsentAuditUploader();

  @override
  Future<void> record({
    required String consentType,
    required String version,
    required String scene,
    required Locale locale,
    String? acceptedAtIso,
  }) async {}
}
