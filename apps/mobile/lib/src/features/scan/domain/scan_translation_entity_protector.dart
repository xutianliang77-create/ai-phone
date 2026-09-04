class ScanTranslationEntityProtector {
  ScanTranslationEntityProtector(this._sourceText)
      : _entities = _findProtectedEntities(_sourceText);

  final String _sourceText;
  final List<_ProtectedEntity> _entities;

  bool get canBypassTranslation {
    if (_entities.isEmpty) return false;
    var remainder = _sourceText;
    for (final entity in _entities.reversed) {
      remainder = remainder.replaceRange(entity.start, entity.end, '');
    }
    return !RegExp(
      r'[A-Za-z0-9\u00C0-\u02AF\u0370-\u052F\u0600-\u06FF\u0900-\u097F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]',
    ).hasMatch(remainder);
  }

  String get translationInput {
    var masked = _sourceText;
    for (var index = _entities.length - 1; index >= 0; index--) {
      final entity = _entities[index];
      masked = masked.replaceRange(entity.start, entity.end, entity.marker);
    }
    return masked;
  }

  String restore(String translatedText) {
    var restored = translatedText.trim();
    final missing = <String>[];
    final appended = <String>{};

    for (final entity in _entities) {
      final marker = entity.markerPattern;
      if (marker.hasMatch(restored)) {
        restored = restored.replaceFirst(marker, entity.text);
        restored = restored.replaceAll(marker, '');
        continue;
      }

      final match = _findStandaloneEntity(restored, entity.text);
      if (match != null) {
        restored = restored.replaceRange(match.$1, match.$2, entity.text);
      } else if (appended.add(entity.text)) {
        missing.add(entity.text);
      }
    }

    restored = restored.replaceAll(
      RegExp(
        r'\s*[_\[\]⟦⟧]*WJ_(?:[^\s_]+_)?\d+_\d+[_\[\]⟦⟧]*\s*',
        caseSensitive: false,
      ),
      ' ',
    );
    restored = restored.trim();
    if (missing.isEmpty) return restored;
    if (restored.isEmpty) return missing.join(' · ');
    return '$restored · ${missing.join(' · ')}';
  }
}

class _ProtectedEntity {
  const _ProtectedEntity({
    required this.start,
    required this.end,
    required this.text,
  });

  final int start;
  final int end;
  final String text;

  String get marker => '__WJ_${start}_${end}__';

  RegExp get markerPattern => RegExp(
        '[_\\[\\]⟦⟧]*WJ_(?:[^\\s_]+_)?${start}_$end[_\\[\\]⟦⟧]*',
        caseSensitive: false,
      );
}

String normalizeScanTranslationEntities(String text) {
  return text.replaceAllMapped(
    RegExp(r'(^|[^A-Za-z0-9])C[€Є](?=$|[^A-Za-z0-9])'),
    (match) => '${match.group(1) ?? ''}CE',
  );
}

List<_ProtectedEntity> _findProtectedEntities(String source) {
  final entities = <_ProtectedEntity>[];

  void addMatches(RegExp pattern, {Set<String> excluded = const <String>{}}) {
    for (final match in pattern.allMatches(source)) {
      final text = match.group(0)!;
      if (excluded.contains(text.toUpperCase()) ||
          entities.any((entity) =>
              match.start < entity.end && match.end > entity.start)) {
        continue;
      }
      entities.add(_ProtectedEntity(
        start: match.start,
        end: match.end,
        text: text,
      ));
    }
  }

  void addGroupMatches(RegExp pattern, int group) {
    for (final match in pattern.allMatches(source)) {
      final text = match.group(group);
      if (text == null || text.isEmpty) continue;
      final end = match.end;
      final start = end - text.length;
      if (end <= start ||
          entities.any(
            (entity) => start < entity.end && end > entity.start,
          )) {
        continue;
      }
      entities.add(_ProtectedEntity(
        start: start,
        end: end,
        text: text,
      ));
    }
  }

  addMatches(RegExp(
    r'\b(?:[A-Z][A-Za-z0-9&.+-]*)(?:[ \t]+[A-Z][A-Za-z0-9&.+-]*){0,4}[ \t]+(?:Technologies|Technology|Electronics|Electric|Corporation|Company|Limited|Holdings|Systems|Solutions|Semiconductors?|Enterprise|Group|Inc\.?|Corp\.?|Ltd\.?|LLC|Co\.?)\b',
  ));
  addGroupMatches(
    RegExp(
      r'(?:制造商|厂商|品牌)\s*[:：]?\s*([A-Z][A-Za-z0-9&.+-]*)',
    ),
    1,
  );
  addGroupMatches(
    RegExp(
      r'(?:Manufacturer|MANUFACTURER|Vendor|VENDOR|Brand|BRAND)\s*[:：]\s*([A-Z][A-Za-z0-9&.+-]*)',
    ),
    1,
  );
  addMatches(RegExp(
    r'\b(?=[A-Za-z0-9./_+-]*[A-Za-z])(?=[A-Za-z0-9./_+-]*\d)[A-Za-z0-9]+(?:[./_+-][A-Za-z0-9]+)+\b',
  ));
  addMatches(RegExp(
    r'\b(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{2,}\b',
  ));
  addMatches(RegExp(r'\b\d+(?:,\d{3})*(?:\.\d+)?\b'));
  addMatches(
    RegExp(r'\b[A-Z][A-Z0-9]{1,23}\b'),
    excluded: const <String>{
      'WARNING',
      'CAUTION',
      'DANGER',
      'INPUT',
      'OUTPUT',
      'MODEL',
      'SERIAL',
      'POWER',
      'SUPPLY',
      'MADE',
      'ONLY',
      'READ',
      'MANUAL',
    },
  );
  addMatches(RegExp(
    r'\b(?:[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b',
  ));

  entities.sort((left, right) => left.start.compareTo(right.start));
  return List<_ProtectedEntity>.unmodifiable(entities);
}

(int, int)? _findStandaloneEntity(String text, String entity) {
  final haystack = text.toLowerCase();
  final needle = entity.toLowerCase();
  var start = 0;
  while (start <= haystack.length - needle.length) {
    final index = haystack.indexOf(needle, start);
    if (index < 0) return null;
    final end = index + needle.length;
    if (_isEntityBoundary(text, index - 1) && _isEntityBoundary(text, end)) {
      return (index, end);
    }
    start = index + 1;
  }
  return null;
}

bool _isEntityBoundary(String text, int index) {
  if (index < 0 || index >= text.length) return true;
  return !RegExp(r'[A-Za-z0-9]').hasMatch(text[index]);
}
