import '../controllers/scan_translation_controller.dart';

bool shouldUseScanTranslationListFallback(
  List<ScanTranslatedBlock> blocks,
) {
  if (blocks.length < 8) return false;

  var narrowBlocks = 0;
  var expandedTranslations = 0;
  for (final block in blocks) {
    final source = block.source;
    if (source.width <= 0.24 || source.width * source.height <= 0.04) {
      narrowBlocks++;
    }
    if (source.width <= 0.32 && block.translation.runes.length >= 18) {
      expandedTranslations++;
    }
  }

  final count = blocks.length;
  return narrowBlocks >= 8 ||
      expandedTranslations >= 8 ||
      (count >= 12 &&
          (narrowBlocks >= (count / 3).ceil() ||
              expandedTranslations >= (count / 2).ceil()));
}
