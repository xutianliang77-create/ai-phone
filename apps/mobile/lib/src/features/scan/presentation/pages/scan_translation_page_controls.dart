part of 'scan_translation_page.dart';

class _StatusLine extends StatelessWidget {
  const _StatusLine({required this.controller});

  final ScanTranslationController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final status = switch (controller.status) {
      ScanTranslationStatus.idle => l10n.scanPickImage,
      ScanTranslationStatus.picking => l10n.open,
      ScanTranslationStatus.imageSelected => l10n.scanImageSelected,
      ScanTranslationStatus.recognizing => l10n.scanRecognizing,
      ScanTranslationStatus.recognized => l10n.recognizedText,
      ScanTranslationStatus.translating => l10n.translate,
      ScanTranslationStatus.translated => l10n.translatedText,
      ScanTranslationStatus.saving => l10n.saveToHistory,
      ScanTranslationStatus.saved => l10n.scanStatusMessage('scan_saved'),
      ScanTranslationStatus.failed => l10n.warning,
    };
    final source = controller.sourceLanguage == 'auto'
        ? (l10n.isChinese ? '自动识别' : 'Auto detect')
        : _languageName(l10n, controller.sourceLanguage);
    final target = _languageName(l10n, controller.targetLanguage);
    final direction = '$source -> $target';
    return Text('${l10n.statusLine(status)} · $direction');
  }
}

class _LanguageDirectionBar extends StatelessWidget {
  const _LanguageDirectionBar({required this.controller});

  final ScanTranslationController controller;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const Icon(Icons.auto_awesome_outlined, size: 18),
            const SizedBox(width: 8),
            Text(chinese ? '自动识别' : 'Auto detect'),
          ],
        ),
        const Icon(Icons.arrow_forward, size: 18),
        PopupMenuButton<String>(
          enabled: !controller.isBusy,
          initialValue: controller.targetLanguage,
          onSelected: controller.setTargetLanguage,
          itemBuilder: (context) => const <PopupMenuEntry<String>>[
            PopupMenuItem(value: 'en', child: Text('English')),
            PopupMenuItem(value: 'zh', child: Text('中文')),
          ],
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(_menuTargetName(context.l10n, controller.targetLanguage)),
              const Icon(Icons.arrow_drop_down),
            ],
          ),
        ),
      ],
    );
  }
}

String _languageName(AppLocalizations l10n, String code) {
  return switch (code) {
    'zh' => l10n.chinese,
    'en' => l10n.english,
    _ => translationLanguageName(code, chinese: l10n.isChinese),
  };
}

String _menuTargetName(AppLocalizations l10n, String code) {
  return switch (code) {
    'zh' => '中文',
    'en' => 'English',
    _ => _languageName(l10n, code),
  };
}
