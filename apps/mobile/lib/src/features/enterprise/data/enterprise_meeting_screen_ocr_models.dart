class EnterpriseMobileScreenOcrRun {
  const EnterpriseMobileScreenOcrRun({
    required this.id,
    required this.meetingId,
    required this.shareId,
    required this.shareGeneration,
    required this.targetLanguage,
    required this.status,
    required this.version,
    this.reasonCode,
    this.providerFingerprint,
  });

  final String id, meetingId, shareId, targetLanguage, status;
  final int shareGeneration, version;
  final String? reasonCode, providerFingerprint;

  factory EnterpriseMobileScreenOcrRun.fromJson(
    Map<String, Object?> json,
    String expectedMeetingId,
  ) {
    final status = _text(json, 'status');
    final generation = json['shareGeneration'];
    final version = json['version'];
    final language = _text(json, 'targetLanguage');
    if (!_uuid(json['id']) ||
        json['meetingId'] != expectedMeetingId ||
        !_uuid(json['shareId']) ||
        generation is! int ||
        generation < 1 ||
        !const <String>{'zh', 'en'}.contains(language) ||
        !const <String>{
          'pending',
          'active',
          'not_configured',
          'failed',
          'ended',
        }.contains(status) ||
        !_optionalCode(json['reasonCode']) ||
        !_optionalFingerprint(json['providerFingerprint']) ||
        !_timestamp(json['createdAt']) ||
        !_timestamp(json['updatedAt']) ||
        (json['endedAt'] != null && !_timestamp(json['endedAt'])) ||
        version is! int ||
        version < 1) {
      throw const FormatException('Invalid enterprise screen OCR run');
    }
    return EnterpriseMobileScreenOcrRun(
      id: json['id']! as String,
      meetingId: expectedMeetingId,
      shareId: json['shareId']! as String,
      shareGeneration: generation,
      targetLanguage: language,
      status: status,
      reasonCode: json['reasonCode'] as String?,
      providerFingerprint: json['providerFingerprint'] as String?,
      version: version,
    );
  }
}

class EnterpriseMobileScreenOcrSubscription {
  const EnterpriseMobileScreenOcrSubscription({
    required this.id,
    required this.runId,
    required this.shareId,
    required this.shareGeneration,
    required this.participantId,
    required this.targetLanguage,
    required this.displayMode,
    required this.enabled,
    required this.version,
  });

  final String id, runId, shareId, participantId, targetLanguage, displayMode;
  final int shareGeneration, version;
  final bool enabled;

  factory EnterpriseMobileScreenOcrSubscription.fromJson(
    Map<String, Object?> json,
    String expectedMeetingId,
  ) {
    final generation = json['shareGeneration'];
    final version = json['version'];
    final language = _text(json, 'targetLanguage');
    final mode = _text(json, 'displayMode');
    if (!_uuid(json['id']) ||
        json['meetingId'] != expectedMeetingId ||
        !_uuid(json['runId']) ||
        !_uuid(json['shareId']) ||
        generation is! int ||
        generation < 1 ||
        !_uuid(json['participantId']) ||
        !const <String>{'zh', 'en'}.contains(language) ||
        !const <String>{'original', 'translated', 'bilingual'}.contains(mode) ||
        json['enabled'] is! bool ||
        !_timestamp(json['createdAt']) ||
        !_timestamp(json['updatedAt']) ||
        version is! int ||
        version < 1) {
      throw const FormatException('Invalid enterprise screen OCR subscription');
    }
    return EnterpriseMobileScreenOcrSubscription(
      id: json['id']! as String,
      runId: json['runId']! as String,
      shareId: json['shareId']! as String,
      shareGeneration: generation,
      participantId: json['participantId']! as String,
      targetLanguage: language,
      displayMode: mode,
      enabled: json['enabled']! as bool,
      version: version,
    );
  }
}

class EnterpriseMobileScreenOcrBlock {
  const EnterpriseMobileScreenOcrBlock({
    required this.id,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
    required this.sourceText,
    required this.translatedText,
  });

  final String id, sourceText, translatedText;
  final double left, top, width, height;

  factory EnterpriseMobileScreenOcrBlock.fromJson(Map<String, Object?> json) {
    final rect = _map(json, 'rect');
    final left = _ratio(rect['left'], allowZero: true);
    final top = _ratio(rect['top'], allowZero: true);
    final width = _ratio(rect['width']);
    final height = _ratio(rect['height']);
    if (!_uuid(json['id']) ||
        left + width > 1.000001 ||
        top + height > 1.000001 ||
        !const <String>{'zh', 'en'}.contains(json['sourceLanguage']) ||
        !_bounded(json['sourceText'], 4000) ||
        !_bounded(json['translatedText'], 4000)) {
      throw const FormatException('Invalid enterprise screen OCR block');
    }
    return EnterpriseMobileScreenOcrBlock(
      id: json['id']! as String,
      left: left,
      top: top,
      width: width,
      height: height,
      sourceText: json['sourceText']! as String,
      translatedText: json['translatedText']! as String,
    );
  }
}

class EnterpriseMobileScreenOcrLayout {
  const EnterpriseMobileScreenOcrLayout({
    required this.frameId,
    required this.runId,
    required this.shareId,
    required this.shareGeneration,
    required this.frameRevision,
    required this.sourceWidth,
    required this.sourceHeight,
    required this.blocks,
  });

  final String frameId, runId, shareId;
  final int shareGeneration, frameRevision, sourceWidth, sourceHeight;
  final List<EnterpriseMobileScreenOcrBlock> blocks;

  factory EnterpriseMobileScreenOcrLayout.fromJson(Map<String, Object?> json) {
    final size = _map(json, 'sourceSize');
    final generation = json['shareGeneration'];
    final revision = json['frameRevision'];
    final width = size['width'];
    final height = size['height'];
    final blocks = json['blocks'];
    if (!_uuid(json['frameId']) ||
        !_uuid(json['runId']) ||
        !_uuid(json['shareId']) ||
        generation is! int ||
        generation < 1 ||
        revision is! int ||
        revision < 1 ||
        width is! int ||
        width < 16 ||
        width > 7680 ||
        height is! int ||
        height < 16 ||
        height > 4320 ||
        json['perceptualHash'] is! String ||
        !RegExp(r'^[a-f0-9]{16}$')
            .hasMatch(json['perceptualHash']! as String) ||
        !_timestamp(json['capturedAt']) ||
        blocks is! List<Object?> ||
        blocks.length > 100) {
      throw const FormatException('Invalid enterprise screen OCR layout');
    }
    return EnterpriseMobileScreenOcrLayout(
      frameId: json['frameId']! as String,
      runId: json['runId']! as String,
      shareId: json['shareId']! as String,
      shareGeneration: generation,
      frameRevision: revision,
      sourceWidth: width,
      sourceHeight: height,
      blocks: blocks.map((value) {
        if (value is! Map<String, Object?>) {
          throw const FormatException('Invalid enterprise screen OCR block');
        }
        return EnterpriseMobileScreenOcrBlock.fromJson(value);
      }).toList(growable: false),
    );
  }
}

class EnterpriseMobileScreenOcrView {
  const EnterpriseMobileScreenOcrView({
    required this.run,
    required this.subscription,
    required this.layout,
  });

  final EnterpriseMobileScreenOcrRun? run;
  final EnterpriseMobileScreenOcrSubscription? subscription;
  final EnterpriseMobileScreenOcrLayout? layout;

  factory EnterpriseMobileScreenOcrView.fromJson(
    Map<String, Object?> json,
    String meetingId,
  ) {
    final run = json['run'] is Map<String, Object?>
        ? EnterpriseMobileScreenOcrRun.fromJson(
            json['run']! as Map<String, Object?>,
            meetingId,
          )
        : null;
    final subscription = json['subscription'] is Map<String, Object?>
        ? EnterpriseMobileScreenOcrSubscription.fromJson(
            json['subscription']! as Map<String, Object?>,
            meetingId,
          )
        : null;
    final layout = json['layout'] is Map<String, Object?>
        ? EnterpriseMobileScreenOcrLayout.fromJson(
            json['layout']! as Map<String, Object?>,
          )
        : null;
    if ((json['run'] != null && run == null) ||
        (json['subscription'] != null && subscription == null) ||
        (json['layout'] != null && layout == null) ||
        (json['replayed'] != null && json['replayed'] != true) ||
        ((run == null) != (subscription == null)) ||
        (run == null && layout != null) ||
        (run != null &&
            subscription != null &&
            (subscription.runId != run.id ||
                subscription.shareId != run.shareId ||
                subscription.shareGeneration != run.shareGeneration ||
                subscription.targetLanguage != run.targetLanguage)) ||
        (run != null &&
            layout != null &&
            (layout.runId != run.id ||
                layout.shareId != run.shareId ||
                layout.shareGeneration != run.shareGeneration))) {
      throw const FormatException('Invalid enterprise screen OCR response');
    }
    return EnterpriseMobileScreenOcrView(
      run: run,
      subscription: subscription,
      layout: layout,
    );
  }
}

Map<String, Object?> _map(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! Map<String, Object?>) {
    throw FormatException('Invalid $key');
  }
  return value;
}

String _text(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is! String || value.trim().isEmpty) {
    throw FormatException('Invalid $key');
  }
  return value;
}

bool _uuid(Object? value) =>
    value is String &&
    RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
            caseSensitive: false)
        .hasMatch(value);
bool _timestamp(Object? value) =>
    value is String && DateTime.tryParse(value) != null;
bool _bounded(Object? value, int maximum) =>
    value is String && value.trim().isNotEmpty && value.length <= maximum;
bool _optionalCode(Object? value) =>
    value == null ||
    value is String && RegExp(r'^[a-z][a-z0-9._:-]{0,159}$').hasMatch(value);
bool _optionalFingerprint(Object? value) =>
    value == null ||
    value is String &&
        RegExp(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$').hasMatch(value);
double _ratio(Object? value, {bool allowZero = false}) {
  if (value is! num ||
      !value.isFinite ||
      value > 1 ||
      (allowZero ? value < 0 : value <= 0)) {
    throw const FormatException('Invalid enterprise screen OCR ratio');
  }
  return value.toDouble();
}
