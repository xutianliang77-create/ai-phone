import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../history/data/session_history_repository.dart';
import '../../../../platform/ocr/mobile_ocr_provider.dart';
import '../../../../platform/ocr/platform_ocr_provider.dart';
import '../../../../platform/translation/api_translation_provider.dart';
import '../../../../platform/translation/ios_system_translation_provider.dart';
import '../../../../platform/translation/mobile_translation_provider.dart';
import '../../../../platform/translation/phrasebook_translation_provider.dart';
import '../controllers/scan_translation_controller.dart';
import '../widgets/scan_image_translation_view.dart';
import '../widgets/scan_text_comparison_view.dart';

class ScanTranslationPage extends StatefulWidget {
  const ScanTranslationPage({
    this.ocrProvider,
    this.translationProvider,
    this.historyRepository,
    this.pickImagePath,
    this.shareText,
    super.key,
  });

  final MobileOcrProvider? ocrProvider;
  final MobileTranslationProvider? translationProvider;
  final SessionHistoryRepository? historyRepository;
  final ScanImagePicker? pickImagePath;
  final Future<void> Function(String text)? shareText;

  @override
  State<ScanTranslationPage> createState() => _ScanTranslationPageState();
}

class _ScanTranslationPageState extends State<ScanTranslationPage> {
  late final SessionHistoryRepository _historyRepository =
      widget.historyRepository ??
          SessionHistoryRepository.fromConfig(AppConfig.fromEnvironment());
  late final ScanTranslationController _controller = ScanTranslationController(
    ocrProvider: widget.ocrProvider ?? PlatformOcrProvider(),
    translationProvider: widget.translationProvider ?? _defaultTranslator(),
    pickImagePath: widget.pickImagePath ?? _pickImagePath,
    historyRepository: _historyRepository,
  );
  final ImagePicker _picker = ImagePicker();

  @override
  void dispose() {
    _controller.dispose();
    if (widget.historyRepository == null) {
      _historyRepository.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.scanTitle)),
      body: SafeArea(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, _) {
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: <Widget>[
                Text(
                  l10n.isChinese ? '看懂眼前的文字' : 'Understand what you see',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 4),
                Text(
                  l10n.isChinese
                      ? '拍照或选择图片，译文会贴合原文位置显示。'
                      : 'Take or choose a photo. Translation stays aligned with the original.',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 12),
                _LanguageDirectionBar(controller: _controller),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: <Widget>[
                    FilledButton.icon(
                      onPressed: _controller.isBusy
                          ? null
                          : () =>
                              _controller.selectImage(ScanImageSource.camera),
                      icon: const Icon(Icons.photo_camera_outlined),
                      label: Text(l10n.scanCamera),
                    ),
                    OutlinedButton.icon(
                      onPressed: _controller.isBusy
                          ? null
                          : () =>
                              _controller.selectImage(ScanImageSource.gallery),
                      icon: const Icon(Icons.photo_library_outlined),
                      label: Text(l10n.scanGallery),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _StatusLine(controller: _controller),
                if (_controller.imagePath.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _controller.isBusy
                        ? null
                        : _controller.recognizeSelectedImage,
                    icon: const Icon(Icons.document_scanner_outlined),
                    label: Text(l10n.recognizedText),
                  ),
                  if (_controller.imagePreviewBytes != null) ...<Widget>[
                    const SizedBox(height: 12),
                    ScanImageTranslationView(
                      imageBytes: _controller.imagePreviewBytes!,
                      aspectRatio: _controller.imageAspectRatio,
                      translatedBlocks: _controller.translatedBlocks,
                      translatedText: _controller.translatedText,
                    ),
                  ],
                ],
                if (_controller.message != null) ...<Widget>[
                  const SizedBox(height: 12),
                  Text(
                    l10n.scanStatusMessage(_controller.message!),
                    style: TextStyle(color: _messageColor(context)),
                  ),
                ],
                if (_controller.recognizedText.isNotEmpty &&
                    _controller.translatedText.isEmpty) ...<Widget>[
                  const SizedBox(height: 20),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(l10n.recognizedText,
                          style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      SelectableText(_controller.recognizedText,
                          style: Theme.of(context).textTheme.bodyLarge),
                    ],
                  ),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    onPressed: _canTranslate
                        ? _controller.translateRecognizedText
                        : null,
                    icon: const Icon(Icons.translate),
                    label: Text(l10n.translate),
                  ),
                ],
                if (_controller.translatedText.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 20),
                  ScanTextComparisonView(
                    sourceText: _controller.recognizedText,
                    translatedText: _controller.translatedText,
                    translatedBlocks: _controller.translatedBlocks,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    runSpacing: 8,
                    children: <Widget>[
                      OutlinedButton.icon(
                        onPressed: _controller.isBusy
                            ? null
                            : () =>
                                _controller.selectImage(ScanImageSource.camera),
                        icon: const Icon(Icons.refresh),
                        label: const Text('重拍'),
                      ),
                      OutlinedButton.icon(
                        onPressed:
                            _controller.canShare ? () => _share(l10n) : null,
                        icon: const Icon(Icons.ios_share_outlined),
                        label: Text(l10n.export),
                      ),
                      FilledButton.icon(
                        onPressed: _canSave ? _controller.save : null,
                        icon: const Icon(Icons.save_outlined),
                        label: Text(l10n.saveToHistory),
                      ),
                    ],
                  ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  bool get _canTranslate {
    return !_controller.isBusy && _controller.recognizedText.trim().isNotEmpty;
  }

  bool get _canSave {
    return !_controller.isBusy &&
        _controller.recognizedText.trim().isNotEmpty &&
        _controller.savedSessionId == null;
  }

  Color _messageColor(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    if (_controller.status == ScanTranslationStatus.saved) {
      return colorScheme.primary;
    }
    return colorScheme.error;
  }

  MobileTranslationProvider _defaultTranslator() {
    final config = AppConfig.fromEnvironment();
    return IosSystemTranslationProvider(
      fallback: ApiTranslationProvider(
        baseUrl: config.apiBaseUrl,
        fallback: PhrasebookTranslationProvider(),
      ),
    );
  }

  Future<PickedScanImage?> _pickImagePath(ScanImageSource source) async {
    final image = await _picker.pickImage(
      source: source == ScanImageSource.camera
          ? ImageSource.camera
          : ImageSource.gallery,
      imageQuality: 92,
    );
    if (image == null) return null;
    final bytes = await image.readAsBytes();
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final aspectRatio = frame.image.width / frame.image.height;
    frame.image.dispose();
    codec.dispose();
    return PickedScanImage(
      path: image.path,
      previewBytes: bytes,
      aspectRatio: aspectRatio,
    );
  }

  Future<void> _share(AppLocalizations l10n) async {
    final text = _shareBody(l10n);
    final shareText = widget.shareText;
    if (shareText != null) {
      await shareText(text);
      return;
    }
    await SharePlus.instance.share(ShareParams(text: text));
  }

  String _shareBody(AppLocalizations l10n) {
    final parts = <String>[];
    if (_controller.recognizedText.trim().isNotEmpty) {
      parts.add('${l10n.recognizedText}\n${_controller.recognizedText}');
    }
    if (_controller.translatedText.trim().isNotEmpty) {
      parts.add('${l10n.translatedText}\n${_controller.translatedText}');
    }
    return parts.join('\n\n');
  }
}

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
    final source = switch (controller.sourceLanguage) {
      'zh' => l10n.chinese,
      'en' => l10n.english,
      _ => l10n.isChinese ? '自动识别' : 'Auto detect',
    };
    final target =
        controller.targetLanguage == 'zh' ? l10n.chinese : l10n.english;
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
              Text(controller.targetLanguage == 'zh' ? '中文' : 'English'),
              const Icon(Icons.arrow_drop_down),
            ],
          ),
        ),
      ],
    );
  }
}
