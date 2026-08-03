class MobileOcrResult {
  const MobileOcrResult({
    required this.text,
    required this.provider,
    this.scripts = const <String>[],
    this.blocks = const <MobileOcrBlock>[],
  });

  final String text;
  final String provider;
  final List<String> scripts;
  final List<MobileOcrBlock> blocks;
}

class MobileOcrBlock {
  const MobileOcrBlock({
    required this.text,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final String text;
  final double left;
  final double top;
  final double width;
  final double height;
}

abstract interface class MobileOcrProvider {
  Future<MobileOcrResult?> recognizeImage(
    String imagePath, {
    List<String>? preferredScripts,
  });

  Future<void> dispose() async {}
}
