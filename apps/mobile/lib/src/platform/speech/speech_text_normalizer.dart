const _zhDigitNames = <String, String>{
  '0': '零',
  '1': '幺',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
};

const _enDigitNames = <String, String>{
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

String normalizeSpeechOutputText(String text, String language) {
  final collapsed = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (collapsed.isEmpty) return collapsed;
  final digitNames = language == 'zh' ? _zhDigitNames : _enDigitNames;
  return _normalizeAlphaNumericCodes(
    _normalizePhoneNumbers(
      _normalizeCurrency(collapsed, language),
      digitNames,
    ),
    digitNames,
  );
}

String _normalizeCurrency(String text, String language) {
  if (language == 'zh') {
    return text
        .replaceAllMapped(
            RegExp(r'[$＄]\s*([0-9]+(?:\.[0-9]+)?)'), (match) => '${match[1]}美元')
        .replaceAllMapped(
            RegExp(r'[¥￥]\s*([0-9]+(?:\.[0-9]+)?)'), (match) => '${match[1]}元')
        .replaceAllMapped(
            RegExp(r'\bUSD\s*([0-9]+(?:\.[0-9]+)?)', caseSensitive: false),
            (match) => '${match[1]}美元')
        .replaceAllMapped(
            RegExp(r'\bRMB\s*([0-9]+(?:\.[0-9]+)?)', caseSensitive: false),
            (match) => '${match[1]}元');
  }
  return text
      .replaceAllMapped(RegExp(r'[$＄]\s*([0-9]+(?:\.[0-9]+)?)'),
          (match) => '${match[1]} dollars')
      .replaceAllMapped(RegExp(r'[¥￥]\s*([0-9]+(?:\.[0-9]+)?)'),
          (match) => '${match[1]} yuan')
      .replaceAllMapped(
          RegExp(r'\bUSD\s*([0-9]+(?:\.[0-9]+)?)', caseSensitive: false),
          (match) => '${match[1]} dollars')
      .replaceAllMapped(
          RegExp(r'\bRMB\s*([0-9]+(?:\.[0-9]+)?)', caseSensitive: false),
          (match) => '${match[1]} yuan');
}

String _normalizePhoneNumbers(
  String text,
  Map<String, String> digitNames,
) {
  return text.replaceAllMapped(RegExp(r'\+?\d[\d\s().-]{5,}\d'), (match) {
    final value = match[0]!;
    if (_looksLikeDate(value)) return value;
    final digits = value.replaceAll(RegExp(r'\D'), '');
    final hasSeparator = RegExp(r'[+\s().-]').hasMatch(value);
    final isLongBareNumber = digits.length >= 10 && value == digits;
    if (digits.length < 7 || (!hasSeparator && !isLongBareNumber)) {
      return value;
    }
    return _spellDigitGroups(value, digitNames);
  });
}

String _normalizeAlphaNumericCodes(
  String text,
  Map<String, String> digitNames,
) {
  return text.replaceAllMapped(
    RegExp(r'\b([A-Za-z]{1,6})(?:[-_]|(?=[0-9]))([0-9][A-Za-z0-9-]{1,})\b'),
    (match) => '${match[1]} ${_spellCodeTail(match[2]!, digitNames)}',
  );
}

String _spellDigitGroups(String value, Map<String, String> digitNames) {
  final separator = digitNames['0'] == 'zero' ? ' ' : '';
  return RegExp(r'\d+')
      .allMatches(value)
      .map((match) =>
          match[0]!.split('').map((digit) => digitNames[digit]).join(separator))
      .join(' ');
}

String _spellCodeTail(String value, Map<String, String> digitNames) {
  return value
      .replaceAll('-', ' ')
      .split('')
      .map((char) => digitNames[char] ?? char)
      .join(' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
}

bool _looksLikeDate(String value) {
  return RegExp(r'^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$').hasMatch(value.trim());
}
