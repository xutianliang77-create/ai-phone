part of 'realtime_controller.dart';

extension RealtimeControllerLocalTranslation on RealtimeController {
  Future<void> _handleAsrTextSegment(
    RealtimeSession session,
    AsrTextSegment segment,
  ) async {
    if (!_canCommitDeviceAsr(session, segment)) return;
    final cleanText = _cleanRealtimeText(segment.text);
    if (cleanText == null) return;
    final cleanSegment =
        cleanText == segment.text ? segment : segment.copyWith(text: cleanText);
    if (!cleanSegment.isFinal &&
        (_config.useLocalSessions ||
            _config.useOnDeviceTranslation ||
            cleanSegment.languageEvidence != AsrLanguageEvidence.legacy)) {
      _displayAsrSource(cleanSegment);
      _localPartialFlush.remember(segment);
      return;
    }
    _localPartialFlush.clearIfSameId(cleanSegment.id);
    if (cleanSegment.languageEvidence != AsrLanguageEvidence.legacy &&
        _translationConfigForAsr(cleanSegment) == null) {
      _displayAsrSource(cleanSegment);
      _message =
          'Speech language or direction unresolved; source text kept on device';
      _notify();
      return;
    }
    if (_message ==
        'Speech language or direction unresolved; source text kept on device') {
      _message = null;
    }
    if (_config.useLocalSessions) {
      await _translateLocalSegment(session, cleanSegment,
          rawText: segment.text);
      return;
    }
    if (_canTranslateOnDevice(cleanSegment)) {
      final translated = await _translateOnDevice(session, cleanSegment);
      if (!_canCommitDeviceAsr(session, cleanSegment)) return;
      if (translated != null) {
        final targetLanguage = _targetLanguageForAsr(cleanSegment);
        _upsertSegment(
          cleanSegment.id,
          sourceText: cleanSegment.text,
          translatedText: translated.text,
          sourceLanguage: _sourceLanguageForAsr(cleanSegment),
          targetLanguage: targetLanguage,
          confidence: cleanSegment.confidence,
          revision: cleanSegment.revision,
          stage: 'translation',
          provider: translated.provider,
        );
        _speakTranslationIfNeeded(translated.text, targetLanguage,
            segmentId: cleanSegment.id,
            isCurrent: () => _canCommitDeviceAsr(session, cleanSegment));
        return;
      }
      if (_config.onDeviceTranslationRequired) {
        _displayAsrSource(cleanSegment);
        _fail('On-device translation unavailable');
        return;
      }
    }
    final sent = _repository.sendTextSegment(
      session.sessionId,
      cleanSegment.languageEvidence == AsrLanguageEvidence.legacy
          ? cleanSegment
          : cleanSegment.copyWith(
              language: _sourceLanguageForAsr(cleanSegment)),
    );
    if (!sent) _fail('Realtime connection lost');
  }

  bool _canCommitDeviceAsr(RealtimeSession? session,
      [AsrTextSegment? segment]) {
    return session != null &&
        identical(_session, session) &&
        !_disposed &&
        !_localTailClosed &&
        (_status == RealtimeStatus.active || _stopInFlight) &&
        (segment == null ||
            (_deviceAsrRecovery.languagePolicyKey == _deviceLanguagePolicyKey &&
                _deviceAsrRecovery.isCurrent(segment)));
  }

  void _displayAsrSource(AsrTextSegment segment) {
    if (segment.isFinal) {
      _asrDraftIds.remove(segment.id);
    } else {
      _asrDraftIds.add(segment.id);
    }
    _upsertSegment(
      segment.id,
      sourceText: segment.text,
      // Keep the existing history LanguageCode contract for unresolved input.
      sourceLanguage: _sourceLanguageForAsr(segment) ?? autoSourceLanguageCode,
      confidence: segment.confidence,
      revision: segment.revision,
      stage: 'asr',
      clearTranslation: true,
    );
  }

  Future<void> _flushPendingLocalPartialTranslation() async {
    final segment = _localPartialFlush.take();
    final session = _session;
    if (segment == null || !_canCommitDeviceAsr(session)) return;
    // Versioned Apple results are committed only by the native SDK watermark
    // or its successful EOF drain, never by a Dart-side stop assumption.
    if (segment.languageEvidence != AsrLanguageEvidence.legacy) return;
    if (!_config.useLocalSessions && !_config.useOnDeviceTranslation) return;
    await _handleAsrTextSegment(session!, segment.copyWith(isFinal: true));
  }

  Future<void> _translateLocalSegment(
    RealtimeSession session,
    AsrTextSegment segment, {
    required String rawText,
  }) async {
    final refined = refinePhoneAsrText(segment.text,
        language: _sourceLanguageForAsr(segment),
        domainPack: _config.domainLexiconPack);
    _displayAsrSource(segment.copyWith(text: refined.text));
    _upsertSegment(segment.id,
        sourceText: refined.text,
        revision: segment.revision,
        rawText: rawText,
        optimizedText: refined.text,
        refinement: {
          'provider': refined.operations.isEmpty ? 'off' : 'local_rules',
          'promptVersion': 'asr_refine_v2',
          'confidence': refined.operations.isEmpty ? 0.7 : 0.86,
          'latencyMs': 0,
          'operations': refined.operations,
          'protectedTermsKept': refined.protectedTermsKept,
          'warnings': refined.warnings,
        });
    final translated = _canTranslateOnDevice(segment)
        ? await _translateOnDevice(session, segment, textOverride: refined.text)
        : null;
    if (!_canCommitDeviceAsr(session, segment)) return;
    if (translated != null) {
      final targetLanguage = _targetLanguageForAsr(segment);
      if (_message == 'On-device translation unavailable') {
        _message = null;
      }
      _upsertSegment(
        segment.id,
        sourceText: refined.text,
        translatedText: translated.text,
        sourceLanguage: _sourceLanguageForAsr(segment),
        targetLanguage: targetLanguage,
        confidence: segment.confidence,
        revision: segment.revision,
        stage: 'translation',
        provider: translated.provider,
      );
      _speakTranslationIfNeeded(translated.text, targetLanguage,
          segmentId: segment.id,
          isCurrent: () => _canCommitDeviceAsr(session, segment));
      return;
    }
    _displayAsrSource(segment.copyWith(text: refined.text));
    if (_config.useLocalSessions) {
      _message = 'On-device translation unavailable';
      _notify();
    }
    if (_config.onDeviceTranslationRequired) {
      _fail('On-device translation unavailable');
    }
  }

  bool _canTranslateOnDevice(AsrTextSegment segment) {
    return _config.useOnDeviceTranslation &&
        segment.isFinal &&
        !_isIgnorableRealtimeText(segment.text) &&
        _mobileTranslationProvider != null;
  }

  Future<MobileTranslationResult?> _translateOnDevice(
    RealtimeSession session,
    AsrTextSegment segment, {
    String? textOverride,
  }) async {
    final config = _translationConfigForAsr(segment);
    if (config == null) return null;
    if (segment.languageEvidence != AsrLanguageEvidence.legacy &&
        _config.sourceLanguage == autoSourceLanguageCode &&
        !_config.autoReverseTargetLanguage) {
      await _checkOnDeviceTranslationResources(config);
      if (!_canCommitDeviceAsr(session, segment)) return null;
    }
    final inputText = textOverride ?? segment.text;
    final protected = protectTranslationText(inputText, config);
    final translated = await _mobileTranslationProvider!.translate(
      protected.text,
      config,
    );
    if (!_canCommitDeviceAsr(session, segment)) return null;
    if (translated == null || !protected.hasProtectedText) return translated;
    final restoredText = protected.restore(translated.text);
    if (restoredText != null) {
      return MobileTranslationResult(
        text: restoredText,
        provider: translated.provider,
      );
    }
    // Some translators may rewrite an unfamiliar placeholder. Retry the
    // original sentence so an internal marker can never reach the UI.
    return _mobileTranslationProvider.translate(inputText, config);
  }

  MobileTranslationConfig? _translationConfigForAsr(AsrTextSegment segment) {
    final language = _sourceLanguageForAsr(segment);
    if (language != null) {
      if (segment.languageEvidence != AsrLanguageEvidence.legacy &&
          !_config.autoReverseTargetLanguage &&
          _config.sourceLanguage != autoSourceLanguageCode &&
          language != normalizeAsrLanguage(_config.sourceLanguage)) {
        return null; // Detected metadata does not override a fixed user source.
      }
      return _translationConfigForLanguage(language,
          allowLegacyAutoReverse:
              segment.languageEvidence == AsrLanguageEvidence.legacy);
    }
    return segment.languageEvidence == AsrLanguageEvidence.legacy
        ? createMobileTranslationConfig(_config)
        : null;
  }

  String? _sourceLanguageForAsr(AsrTextSegment segment) {
    final reported = normalizeAsrLanguage(segment.language);
    switch (segment.languageEvidence) {
      case AsrLanguageEvidence.legacy:
        // Retain 1.0 text routing only for legacy providers, not acoustic LID.
        return reported ?? _dominantTextLanguage(segment.text);
      case AsrLanguageEvidence.userSelected:
        final selected = normalizeAsrLanguage(_config.sourceLanguage);
        return selected == reported ? selected : null;
      case AsrLanguageEvidence.detected:
        return reported;
      case AsrLanguageEvidence.textInferred:
      case AsrLanguageEvidence.mixed:
      case AsrLanguageEvidence.unknown:
        return null;
    }
  }

  MobileTranslationConfig? _translationConfigForLanguage(String? language,
      {required bool allowLegacyAutoReverse}) {
    final sourceLanguage = _normalizedTranslationSource(language);
    if (sourceLanguage == null) return null;
    final targetLanguage = _targetLanguageForSource(sourceLanguage,
        allowLegacyAutoReverse: allowLegacyAutoReverse);
    if (targetLanguage == null || targetLanguage == sourceLanguage) return null;
    return MobileTranslationConfig(
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
    );
  }

  String _targetLanguageForAsr(AsrTextSegment segment) {
    return _translationConfigForAsr(segment)?.targetLanguage ??
        _config.targetLanguage;
  }

  String? _normalizedTranslationSource(String? language) {
    return language == null ? null : normalizeAsrLanguage(language);
  }

  String? _targetLanguageForSource(String sourceLanguage,
      {required bool allowLegacyAutoReverse}) {
    final targetLanguage = _config.targetLanguage;
    if (!allowLegacyAutoReverse) {
      return _config.autoReverseTargetLanguage
          ? explicitRealtimeLanguagePair(_config)?.opposite(sourceLanguage)
          : normalizeAsrLanguage(targetLanguage);
    }
    final selectedPair = _config.automaticLanguagePair;
    if (_config.autoReverseTargetLanguage && selectedPair != null) {
      return selectedPair.opposite(sourceLanguage) ?? targetLanguage;
    }
    final pairSourceLanguage =
        _normalizedTranslationSource(_config.sourceLanguage);
    if (_config.autoReverseTargetLanguage &&
        allowLegacyAutoReverse &&
        (pairSourceLanguage == null || pairSourceLanguage == targetLanguage)) {
      // Keep the old implicit zh/en pair only for the 1.0 provider contract.
      return oppositeTargetLanguageCode(sourceLanguage);
    }
    if (!_config.autoReverseTargetLanguage &&
        _config.realtimeMode != 'conversation') {
      return targetLanguage;
    }
    if (sourceLanguage != targetLanguage) return targetLanguage;
    if (pairSourceLanguage == null || pairSourceLanguage == sourceLanguage) {
      return targetLanguage;
    }
    return pairSourceLanguage;
  }

  String? _dominantTextLanguage(String text) {
    var zhCount = 0;
    var enCount = 0;
    for (final rune in text.runes) {
      final language = _scriptLanguage(String.fromCharCode(rune));
      if (language == 'zh') zhCount++;
      if (language == 'en') enCount++;
    }
    if (zhCount == 0 && enCount == 0) return null;
    if (zhCount > 0 && zhCount * 2 >= enCount) return 'zh';
    return 'en';
  }

  String? _scriptLanguage(String char) {
    if (RegExp(r'[\u4e00-\u9fff]').hasMatch(char)) return 'zh';
    if (RegExp(r'[A-Za-z]').hasMatch(char)) return 'en';
    return null;
  }
}

class _LocalPartialTranslationFlush {
  AsrTextSegment? _segment;

  void remember(AsrTextSegment segment) {
    _segment = segment;
  }

  AsrTextSegment? take() {
    final segment = _segment;
    cancel();
    return segment;
  }

  void clearIfSameId(String id) {
    if (_segment?.id == id) cancel();
  }

  void cancel() {
    _segment = null;
  }
}
