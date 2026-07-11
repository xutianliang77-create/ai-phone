import 'dart:convert';

import '../../../app/app_config.dart';
import '../../../platform/sharing/file_share_service.dart';
import '../../../platform/sharing/local_file_share_service.dart';
import '../../realtime/domain/entities/subtitle_segment.dart';
import 'local_session_store.dart';
import 'session_history_api_client.dart';
import 'session_history_models.dart';

class SessionHistoryRepository {
  SessionHistoryRepository({
    SessionHistoryApiClient? apiClient,
    LocalSessionStore? localStore,
    required FileShareService shareService,
    DateTime Function()? now,
  })  : _apiClient = apiClient,
        _localStore = localStore,
        _shareService = shareService,
        _now = now ?? DateTime.now;

  factory SessionHistoryRepository.fromConfig(AppConfig config) {
    if (config.useLocalSessions) {
      return SessionHistoryRepository(
        localStore: LocalSessionStore(),
        shareService: LocalFileShareService(),
      );
    }
    return SessionHistoryRepository(
      apiClient: SessionHistoryApiClient(baseUrl: config.apiBaseUrl),
      shareService: LocalFileShareService(),
    );
  }

  final SessionHistoryApiClient? _apiClient;
  final LocalSessionStore? _localStore;
  final FileShareService _shareService;
  final DateTime Function() _now;

  Future<List<SessionListItem>> listSessions({String query = ''}) {
    final localStore = _localStore;
    if (localStore != null) return localStore.listSessions(query: query);
    return _apiClient!.listSessions(query: query);
  }

  Future<SessionDetail> getSession(String sessionId) {
    final localStore = _localStore;
    if (localStore != null) return localStore.getSession(sessionId);
    return _apiClient!.getSession(sessionId);
  }

  Future<SessionDetail> saveTypeToSpeakSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
  }) {
    return saveTextTranslationSession(
      sourceText: sourceText,
      translatedText: translatedText,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      sourceKind: 'type_to_speak',
    );
  }

  Future<SessionDetail> saveTextTranslationSession({
    required String sourceText,
    required String translatedText,
    required String sourceLanguage,
    required String targetLanguage,
    required String sourceKind,
  }) async {
    final localStore = _localStore;
    if (localStore == null) {
      return _apiClient!.saveTextTranslationSession(
        sourceText: sourceText,
        translatedText: translatedText,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage,
        sourceKind: sourceKind,
      );
    }

    final createdAt = _now();
    final sessionId = '${_sessionPrefix(sourceKind)}'
        '_${createdAt.microsecondsSinceEpoch}';
    await localStore.saveEndedSession(
      sessionId: sessionId,
      createdAt: createdAt,
      segments: <SubtitleSegment>[
        SubtitleSegment(
          id: '${_sessionPrefix(sourceKind)}_1',
          sourceText: sourceText,
          translatedText: translatedText,
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
          stage: 'translation',
        ),
      ],
    );
    return localStore.getSession(sessionId);
  }

  Future<SessionDetail> generateReview(String sessionId) {
    final localStore = _localStore;
    if (localStore != null) return localStore.getSession(sessionId);
    return _apiClient!.generateReview(sessionId);
  }

  Future<TermbaseTerm> confirmTerm({
    required String sessionId,
    required String sourceText,
    required String translatedText,
  }) {
    if (_localStore != null) {
      return Future.value(TermbaseTerm(
        id: 'local_${sourceText.hashCode}_${translatedText.hashCode}',
        sourceText: sourceText,
        translatedText: translatedText,
        sourceLanguage: _detectLanguage(sourceText),
        targetLanguage: _detectLanguage(translatedText),
        status: 'active',
      ));
    }
    return _apiClient!.confirmTerm(
      sessionId: sessionId,
      sourceText: sourceText,
      translatedText: translatedText,
    );
  }

  Future<TermbaseTerm> revokeTerm(String termId) {
    if (_localStore != null) {
      return Future.value(TermbaseTerm(
        id: termId,
        sourceText: '',
        translatedText: '',
        sourceLanguage: 'zh',
        targetLanguage: 'en',
        status: 'revoked',
      ));
    }
    return _apiClient!.revokeTerm(termId);
  }

  Future<void> shareExport(
    String sessionId, {
    String format = 'markdown',
  }) async {
    final localStore = _localStore;
    final export = localStore == null
        ? await _apiClient!.exportSession(sessionId, format: format)
        : await localStore.exportSession(sessionId, format: format);
    final path = await _shareService.saveExportFile(
      utf8.encode(export.content),
      export.filename,
    );
    await _shareService.shareFile(path, mimeType: export.mimeType);
  }

  Future<void> deleteSession(String sessionId) {
    final localStore = _localStore;
    if (localStore != null) return localStore.deleteSession(sessionId);
    return _apiClient!.deleteSession(sessionId);
  }

  void dispose() {
    _apiClient?.close();
  }
}

String _detectLanguage(String text) {
  return RegExp(r'[\u4e00-\u9fff]').hasMatch(text) ? 'zh' : 'en';
}

String _sessionPrefix(String sourceKind) {
  return switch (sourceKind) {
    'scan' => 'scan',
    'type_to_speak' => 'typed',
    _ => 'text',
  };
}
