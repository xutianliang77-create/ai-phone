class MobileOcrResult {
  const MobileOcrResult({
    required this.text,
    required this.provider,
    this.scripts = const <String>[],
  });

  final String text;
  final String provider;
  final List<String> scripts;
}

abstract interface class MobileOcrProvider {
  Future<MobileOcrResult?> recognizeImage(String imagePath);

  Future<void> dispose() async {}
}
