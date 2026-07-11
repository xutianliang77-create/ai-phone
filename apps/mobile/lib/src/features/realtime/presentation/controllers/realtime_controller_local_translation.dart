part of 'realtime_controller.dart';

const _localPartialFlushDelay = Duration(milliseconds: 1600);

extension RealtimeControllerLocalTranslation on RealtimeController {
  Future<void> _handleAsrTextSegment(
    String sessionId,
    AsrTextSegment segment,
  ) async {
    final cleanText = _cleanRealtimeText(segment.text);
    if (cleanText == null) return;
    final cleanSegment = cleanText == segment.text
        ? segment
        : AsrTextSegment(
            id: segment.id,
            text: cleanText,
            language: segment.language,
            isFinal: segment.isFinal,
            confidence: segment.confidence,
          );
    if (_config.useLocalSessions) {
      await _handleLocalAsrTextSegment(cleanSegment);
      return;
    }
    if (_canTranslateOnDevice(cleanSegment)) {
      final translated = await _translateOnDevice(cleanSegment);
      if (translated != null) {
        final targetLanguage = _targetLanguageForAsr(cleanSegment);
        _upsertSegment(
          cleanSegment.id,
          sourceText: cleanSegment.text,
          translatedText: translated.text,
          sourceLanguage: cleanSegment.language,
          targetLanguage: targetLanguage,
          confidence: cleanSegment.confidence,
          stage: 'translation',
          provider: translated.provider,
        );
        _speakTranslationIfNeeded(translated.text, targetLanguage);
        return;
      }
      if (_config.onDeviceTranslationRequired) {
        _upsertSegment(
          cleanSegment.id,
          sourceText: cleanSegment.text,
          sourceLanguage: cleanSegment.language,
          confidence: cleanSegment.confidence,
          stage: 'asr',
        );
        _fail('On-device translation unavailable');
        return;
      }
    }
    final sent = _repository.sendTextSegment(sessionId, cleanSegment);
    if (!sent) _fail('Realtime connection lost');
  }

  Future<void> _handleLocalAsrTextSegment(AsrTextSegment segment) async {
    if (!segment.isFinal) {
      _upsertSegment(
        segment.id,
        sourceText: segment.text,
        sourceLanguage: segment.language,
        confidence: segment.confidence,
        stage: 'asr',
      );
      _scheduleLocalPartialTranslation(segment);
      return;
    }
    _localPartialFlush.clearIfSameId(segment.id);
    await _translateLocalSegment(segment);
  }

  Future<void> _flushPendingLocalPartialTranslation() async {
    final segment = _localPartialFlush.take();
    if (segment == null || !_config.useLocalSessions) return;
    if (_status != RealtimeStatus.listening && !_stopInFlight) return;
    await _translateLocalSegment(AsrTextSegment(
      id: segment.id,
      text: segment.text,
      language: segment.language,
      isFinal: true,
      confidence: segment.confidence,
    ));
  }

  Future<void> _translateLocalSegment(AsrTextSegment segment) async {
    final translated = _canTranslateOnDevice(segment)
        ? await _translateOnDevice(segment)
        : null;
    if (translated != null) {
      final targetLanguage = _targetLanguageForAsr(segment);
      _upsertSegment(
        segment.id,
        sourceText: segment.text,
        translatedText: translated.text,
        sourceLanguage: segment.language,
        targetLanguage: targetLanguage,
        confidence: segment.confidence,
        stage: 'translation',
        provider: translated.provider,
      );
      _speakTranslationIfNeeded(translated.text, targetLanguage);
      return;
    }
    _upsertSegment(
      segment.id,
      sourceText: segment.text,
      sourceLanguage: segment.language,
      confidence: segment.confidence,
      stage: 'asr',
    );
    if (_config.onDeviceTranslationRequired) {
      _fail('On-device translation unavailable');
    }
  }

  void _scheduleLocalPartialTranslation(AsrTextSegment segment) {
    if (!_canTranslateLocalPartial(segment)) return;
    _localPartialFlush.schedule(
      segment,
      _localPartialFlushDelay,
      _flushPendingLocalPartialTranslation,
    );
  }

  bool _canTranslateLocalPartial(AsrTextSegment segment) {
    return _config.useOnDeviceTranslation &&
        !_isIgnorableRealtimeText(segment.text) &&
        _mobileTranslationProvider != null;
  }

  bool _canTranslateOnDevice(AsrTextSegment segment) {
    return _config.useOnDeviceTranslation &&
        segment.isFinal &&
        !_isIgnorableRealtimeText(segment.text) &&
        _mobileTranslationProvider != null;
  }

  Future<MobileTranslationResult?> _translateOnDevice(
    AsrTextSegment segment,
  ) async {
    final chunks = _translationChunks(segment.text);
    if (chunks.length < 2) {
      final config = _translationConfigForAsr(segment);
      if (config == null) return null;
      return _mobileTranslationProvider!.translate(
        segment.text,
        config,
      );
    }
    final translatedChunks = <String>[];
    String? provider;
    for (final chunk in chunks) {
      final config = _translationConfigForLanguage(chunk.language);
      if (config == null) {
        translatedChunks.add(chunk.text);
        continue;
      }
      final translated = await _mobileTranslationProvider!.translate(
        chunk.text,
        config,
      );
      if (translated == null) continue;
      provider ??= translated.provider;
      translatedChunks.add(translated.text);
    }
    if (translatedChunks.isEmpty) return null;
    return MobileTranslationResult(
      text: translatedChunks.join(' / '),
      provider: provider ?? 'ios_system',
    );
  }

  MobileTranslationConfig? _translationConfigForAsr(AsrTextSegment segment) {
    final language = _recognizedSpeechLanguage(segment.language) ??
        _dominantTextLanguage(segment.text);
    if (language != null) return _translationConfigForLanguage(language);
    return _translationConfigForLanguage(language) ??
        createMobileTranslationConfig(_config);
  }

  MobileTranslationConfig? _translationConfigForLanguage(String? language) {
    final sourceLanguage = _normalizedTranslationSource(language);
    if (sourceLanguage == null) return null;
    final targetLanguage = _targetLanguageForSource(sourceLanguage);
    if (targetLanguage == sourceLanguage) return null;
    return MobileTranslationConfig(
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
    );
  }

  String _targetLanguageForAsr(AsrTextSegment segment) {
    final language = _recognizedSpeechLanguage(segment.language) ??
        _dominantTextLanguage(segment.text);
    return _translationConfigForLanguage(language)?.targetLanguage ??
        _config.targetLanguage;
  }

  String? _normalizedTranslationSource(String? language) {
    if (language == null) return null;
    if (language == 'zh-Hant' || language == 'yue') return language;
    final normalized = language.trim().toLowerCase();
    if (normalized == 'zh' || normalized == 'en') return normalized;
    return isSupportedHyMtLanguageCode(normalized) ? normalized : null;
  }

  String _targetLanguageForSource(String sourceLanguage) {
    if (_config.autoReverseTargetLanguage) {
      return oppositeTargetLanguageCode(sourceLanguage);
    }
    final targetLanguage = _config.targetLanguage;
    if (_config.realtimeMode != 'conversation') return targetLanguage;
    if (sourceLanguage != targetLanguage) return targetLanguage;
    final pairSourceLanguage =
        _normalizedTranslationSource(_config.sourceLanguage);
    if (pairSourceLanguage == null || pairSourceLanguage == sourceLanguage) {
      return targetLanguage;
    }
    return pairSourceLanguage;
  }

  String? _recognizedSpeechLanguage(String rawLanguage) {
    final language = rawLanguage.trim().toLowerCase();
    if (language == 'zh' ||
        language.startsWith('zh-') ||
        language == 'cmn' ||
        language.startsWith('cmn-')) {
      return 'zh';
    }
    if (language == 'en' || language.startsWith('en-')) {
      return 'en';
    }
    return null;
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

  List<_TranslationChunk> _translationChunks(String text) {
    final chunks = <_TranslationChunk>[];
    final buffer = StringBuffer();
    String? currentLanguage;
    for (final rune in text.runes) {
      final char = String.fromCharCode(rune);
      final language = _scriptLanguage(char);
      if (language != null &&
          currentLanguage != null &&
          language != currentLanguage &&
          buffer.toString().trim().isNotEmpty) {
        chunks
            .add(_TranslationChunk(buffer.toString().trim(), currentLanguage));
        buffer.clear();
        currentLanguage = language;
      }
      currentLanguage ??= language;
      buffer.write(char);
    }
    final tail = buffer.toString().trim();
    if (tail.isNotEmpty && currentLanguage != null) {
      chunks.add(_TranslationChunk(tail, currentLanguage));
    }
    return chunks.length > 1 ? chunks : const <_TranslationChunk>[];
  }

  String? _scriptLanguage(String char) {
    if (RegExp(r'[\u4e00-\u9fff]').hasMatch(char)) return 'zh';
    if (RegExp(r'[A-Za-z]').hasMatch(char)) return 'en';
    return null;
  }
}

class _TranslationChunk {
  const _TranslationChunk(this.text, this.language);

  final String text;
  final String language;
}

class _LocalPartialTranslationFlush {
  Timer? _timer;
  AsrTextSegment? _segment;

  void schedule(
    AsrTextSegment segment,
    Duration delay,
    Future<void> Function() flush,
  ) {
    _segment = segment;
    _timer?.cancel();
    _timer = Timer(delay, () {
      _timer = null;
      unawaited(flush());
    });
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
    _timer?.cancel();
    _timer = null;
    _segment = null;
  }
}
