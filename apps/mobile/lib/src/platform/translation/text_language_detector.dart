String detectTextLanguage(String text) {
  var zhCount = 0;
  var enCount = 0;
  for (final rune in text.runes) {
    final char = String.fromCharCode(rune);
    if (RegExp(r'[\u4e00-\u9fff]').hasMatch(char)) zhCount++;
    if (RegExp(r'[A-Za-z]').hasMatch(char)) enCount++;
  }
  if (zhCount > 0 && zhCount * 2 >= enCount) return 'zh';
  return 'en';
}
