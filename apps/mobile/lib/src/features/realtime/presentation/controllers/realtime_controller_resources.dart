part of 'realtime_controller.dart';

int _resourceRequestSerial = 0;

class _LocalResourceState {
  List<RealtimeLocalResource> items = [];
  bool busy = false;
  int generation = 0;
  Completer<void>? cancelled;
  Future<void> Function()? cancelNative;
}

class _LocalResourceCancelled implements Exception {}

extension RealtimeControllerResources on RealtimeController {
  bool get resourceOperationRunning => _localResources.busy;
  List<RealtimeLocalResource> get localResources =>
      List.unmodifiable(_localResources.items);
  bool get onDeviceAutomaticLanguageUnsupported =>
      _config.useLocalSessions &&
      _config.sourceLanguage == autoSourceLanguageCode;
  bool get canCheckLocalResources =>
      !_disposed &&
      !resourceOperationRunning &&
      !onDeviceAutomaticLanguageUnsupported &&
      _config.useLocalSessions &&
      _config.deviceAsrProvider == 'apple_speech_transcriber' &&
      _config.useDeviceAsr &&
      _config.useOnDeviceTranslation &&
      _config.onDeviceTranslationProvider == 'ios_system' &&
      (_status == RealtimeStatus.idle || isTerminalRealtimeStatus(_status));

  List<RealtimeLocalResource> _resourceTargets() {
    final source = canonicalTranslationLanguageCode(_config.sourceLanguage);
    final target = canonicalTranslationLanguageCode(_config.targetLanguage);
    final pair = _config.autoReverseTargetLanguage
        ? explicitRealtimeLanguagePair(_config)
        : null;
    if (pair != null) {
      return [
        if (source == null)
          const RealtimeLocalResource(
              kind: LocalResourceKind.asr,
              sourceLanguage: 'auto',
              phase: LocalResourcePhase.unsupported,
              reason: 'automaticLanguageNotQualified'),
        for (final language in [pair.source, pair.target])
          RealtimeLocalResource(
              kind: LocalResourceKind.asr, sourceLanguage: language),
        RealtimeLocalResource(
            kind: LocalResourceKind.translation,
            sourceLanguage: pair.source,
            targetLanguage: pair.target),
        RealtimeLocalResource(
            kind: LocalResourceKind.translation,
            sourceLanguage: pair.target,
            targetLanguage: pair.source),
      ];
    }
    // Never guess en/zh or infer a missing source merely to download a pack.
    if (_config.autoReverseTargetLanguage ||
        source == null ||
        target == null ||
        source == target) {
      return [
        RealtimeLocalResource(
            kind: LocalResourceKind.asr,
            sourceLanguage: _config.sourceLanguage,
            targetLanguage: _config.targetLanguage,
            phase: LocalResourcePhase.unsupported,
            reason: 'fixed_language_pair_required')
      ];
    }
    return [
      RealtimeLocalResource(
          kind: LocalResourceKind.asr, sourceLanguage: source),
      RealtimeLocalResource(
          kind: LocalResourceKind.translation,
          sourceLanguage: source,
          targetLanguage: target)
    ];
  }

  Future<void> checkLocalResources() async {
    if (!canCheckLocalResources) return;
    _localResources.items = [..._resourceTargets(), ..._voiceResourceTargets()];
    await _runResourceWork((generation) async {
      for (final item
          in List<RealtimeLocalResource>.of(_localResources.items)) {
        if (!_resourceCurrent(generation)) return;
        if (item.phase == LocalResourcePhase.unsupported) continue;
        _resourceReplace(item.observed(LocalResourcePhase.checking, ''));
        try {
          final result = await _readResource(item);
          if (_resourceCurrent(generation)) _resourceReplace(result);
        } catch (error) {
          if (_resourceCurrent(generation)) {
            _resourceReplace(item.observed(
                LocalResourcePhase.failed, _resourceErrorCode(error)));
          }
        }
      }
    }, const Duration(seconds: 30));
  }

  Future<void> prepareLocalResource(String id,
      {required bool downloadAuthorized}) async {
    if (!downloadAuthorized || !canCheckLocalResources) return;
    final matches =
        _localResources.items.where((item) => item.id == id && item.canPrepare);
    if (matches.isEmpty) return;
    final item = matches.first;
    final requestId =
        'resource-${DateTime.now().microsecondsSinceEpoch}-${++_resourceRequestSerial}';
    await _runResourceWork((generation) async {
      _resourceReplace(item.observed(LocalResourcePhase.preparing, ''));
      if (item.kind == LocalResourceKind.asr) {
        final provider = _mobileAsrProvider as MobileAsrResourcePreparation;
        _localResources.cancelNative =
            () => provider.cancelResourcePreparation(requestId);
        await provider.prepareResources(
            _resourceAsrConfig(item, download: true),
            requestId: requestId);
      } else {
        final provider =
            _mobileTranslationProvider as MobileTranslationResourcePreparation;
        _localResources.cancelNative =
            () => provider.cancelResourcePreparation(requestId);
        await provider.prepareResources(_resourceTranslationConfig(item),
            requestId: requestId);
      }
      if (!_resourceCurrent(generation)) return;
      // A completed SDK request may still leave installation pending.
      final observed = await _readResource(item);
      if (_resourceCurrent(generation)) _resourceReplace(observed);
    }, const Duration(minutes: 5), preparing: item);
  }

  Future<void> cancelLocalResourcePreparation() async {
    if (!resourceOperationRunning) return;
    final cancelNative = _localResources.cancelNative;
    final cancelled = _localResources.cancelled;
    if (cancelled != null && !cancelled.isCompleted) cancelled.complete();
    // Stop waiting promptly. Shared OS downloads are not claimed to be removed.
    if (cancelNative != null) {
      await ignoreCleanupError(
          () => cancelNative().timeout(const Duration(seconds: 2)));
    }
  }

  Future<void> _runResourceWork(
      Future<void> Function(int) action, Duration timeout,
      {RealtimeLocalResource? preparing}) async {
    final state = _localResources;
    final generation = ++state.generation;
    state.busy = true;
    final cancelled = state.cancelled = Completer<void>();
    _notify();
    try {
      await Future.any<void>([
        Future<void>.sync(() => action(generation)),
        cancelled.future.then<void>((_) => throw _LocalResourceCancelled())
      ]).timeout(timeout);
    } catch (error) {
      if (error is TimeoutException) await cancelLocalResourcePreparation();
      if (!_disposed && state.generation == generation) {
        final phase =
            _resourceErrorCode(error) == 'resource_preparation_cancelled'
                ? LocalResourcePhase.cancelled
                : LocalResourcePhase.failed;
        for (final item in List<RealtimeLocalResource>.of(state.items)) {
          if (item.id == preparing?.id ||
              item.phase == LocalResourcePhase.checking) {
            _resourceReplace(item.observed(phase, _resourceErrorCode(error),
                canPrepare: preparing?.canPrepare ?? false));
          }
        }
      }
    } finally {
      if (state.generation == generation) {
        state.busy = false;
        state.cancelNative = null;
        _notify();
      }
    }
  }

  bool _resourceCurrent(int generation) =>
      !_disposed &&
      _localResources.generation == generation &&
      _localResources.cancelled?.isCompleted == false;
  void _resourceReplace(RealtimeLocalResource value) {
    _localResources.items = [
      for (final item in _localResources.items)
        item.id == value.id ? value : item
    ];
    _notify();
  }

  MobileAsrConfig _resourceAsrConfig(RealtimeLocalResource item,
          {bool download = false}) =>
      createDeviceAsrConfig(
          _config.copyWith(sourceLanguage: item.sourceLanguage),
          autoDownloadModel: download);
  MobileTranslationConfig _resourceTranslationConfig(
          RealtimeLocalResource item) =>
      MobileTranslationConfig(
          sourceLanguage: item.sourceLanguage,
          targetLanguage: item.targetLanguage!);

  Future<RealtimeLocalResource> _readResource(
      RealtimeLocalResource item) async {
    if (item.kind == LocalResourceKind.speech) return _readVoiceResource(item);
    String reason;
    bool ready, preparable;
    if (item.kind == LocalResourceKind.asr) {
      final provider = _mobileAsrProvider;
      if (provider is! MobileAsrDiagnostics) {
        throw UnsupportedError('missing_resource_diagnostics');
      }
      final observed = await (provider as MobileAsrDiagnostics)
          .availability(_resourceAsrConfig(item));
      reason = observed.reason;
      ready = observed.canStart;
      if (ready &&
          !translationLanguagesMatch(
              observed.details['locale'] as String? ?? '',
              item.sourceLanguage)) {
        ready = false;
        reason = 'resource_language_mismatch';
      }
      preparable = provider is MobileAsrResourcePreparation;
    } else {
      final provider = _mobileTranslationProvider;
      if (provider is! MobileTranslationDiagnostics) {
        throw UnsupportedError('missing_resource_diagnostics');
      }
      final config = _resourceTranslationConfig(item);
      final observed =
          await (provider as MobileTranslationDiagnostics).availability(config);
      reason = observed.reason;
      ready = observed.available && observed.matchesLanguagePair(config);
      if (observed.available && !ready) reason = 'resource_language_mismatch';
      preparable = provider is MobileTranslationResourcePreparation;
    }
    if (ready) return item.observed(LocalResourcePhase.ready, 'ready');
    if (reason == 'language_resource_downloading') {
      return item.observed(LocalResourcePhase.preparing, reason);
    }
    if (reason == 'language_resource_not_ready') {
      return item.observed(LocalResourcePhase.failed, reason,
          canPrepare: preparable);
    }
    final missing = [
      'languageResourceMissing',
      'language_resource_missing',
      'language_pair_not_installed'
    ].contains(reason);
    final unsupported = [
      'automaticLanguageNotQualified',
      'unsupportedLanguage',
      'unsupported_language_pair',
      'ios_26_required',
      'ios_translation_requires_ios_26'
    ].contains(reason);
    return item.observed(
        missing
            ? LocalResourcePhase.missing
            : unsupported
                ? LocalResourcePhase.unsupported
                : LocalResourcePhase.failed,
        reason,
        canPrepare: missing && preparable);
  }

  String _resourceErrorCode(Object error) => error is _LocalResourceCancelled
      ? 'resource_preparation_cancelled'
      : error is TimeoutException
          ? 'resource_preparation_timeout'
          : error is PlatformException
              ? error.code
              : 'resource_preparation_failed';

  // Preserve the 1.0 preflight, allowing only verified local Apple registration
  // before a second readiness check. Capture preparation never downloads.
  Future<void> _prepareDeviceAsr() async {
    final provider = _mobileAsrProvider;
    if (provider == null) {
      throw UnsupportedError('Device ASR provider is not configured');
    }
    final diagnostics = provider is MobileAsrDiagnostics
        ? provider as MobileAsrDiagnostics
        : null;
    if (diagnostics == null) return;
    final config = createDeviceAsrConfig(_config,
        autoDownloadModel:
            _config.deviceAsrProvider == 'apple_speech_transcriber'
                ? false
                : null);
    var availability = await diagnostics.availability(config);
    final preparation = provider is MobileAsrPreparation
        ? provider as MobileAsrPreparation
        : null;
    var preparedLocally = false;
    if (!availability.canStart &&
        preparation != null &&
        _config.deviceAsrProvider == 'apple_speech_transcriber' &&
        availability.details['canPrepareLocally'] == true &&
        translationLanguagesMatch(
            availability.details['locale'] as String? ?? '', config.language)) {
      await preparation.prepare(config);
      preparedLocally = true;
      availability = await diagnostics.availability(config);
    }
    if (!availability.canStart) throw UnsupportedError(availability.message);
    if (preparation == null) return;
    _message = availability.reason == 'ready'
        ? 'Preparing device ASR model'
        : availability.message;
    _notify();
    if (!preparedLocally) await preparation.prepare(config);
    _message = _config.useLocalSessions
        ? 'Device ASR model ready. Starting local session'
        : 'Device ASR model ready. Connecting realtime session';
    _notify();
  }
}
