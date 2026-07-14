import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/scan_translation_controller.dart';

class ScanImageTranslationView extends StatefulWidget {
  const ScanImageTranslationView({
    required this.imageBytes,
    required this.aspectRatio,
    required this.translatedBlocks,
    required this.translatedText,
    super.key,
  });

  final Uint8List imageBytes;
  final double aspectRatio;
  final List<ScanTranslatedBlock> translatedBlocks;
  final String translatedText;

  @override
  State<ScanImageTranslationView> createState() =>
      _ScanImageTranslationViewState();
}

class _ScanImageTranslationViewState extends State<ScanImageTranslationView> {
  bool _showTranslation = false;

  bool get _hasTranslation => widget.translatedText.trim().isNotEmpty;

  @override
  void didUpdateWidget(covariant ScanImageTranslationView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.translatedText.isEmpty && _hasTranslation) {
      _showTranslation = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                l10n.scanStatusMessage('scanImageComparison'),
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            if (_hasTranslation)
              SegmentedButton<bool>(
                segments: <ButtonSegment<bool>>[
                  ButtonSegment<bool>(
                    value: false,
                    label: Text(l10n.scanStatusMessage('scanOriginalLayer')),
                    icon: const Icon(Icons.image_outlined),
                  ),
                  ButtonSegment<bool>(
                    value: true,
                    label: Text(l10n.scanStatusMessage('scanTranslationLayer')),
                    icon: const Icon(Icons.translate),
                  ),
                ],
                selected: <bool>{_showTranslation},
                onSelectionChanged: (selection) {
                  setState(() => _showTranslation = selection.single);
                },
                showSelectedIcon: false,
              ),
          ],
        ),
        const SizedBox(height: 10),
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: AspectRatio(
            aspectRatio: widget.aspectRatio,
            child: Stack(
              fit: StackFit.expand,
              children: <Widget>[
                Image.memory(
                  widget.imageBytes,
                  fit: BoxFit.fill,
                  semanticLabel: l10n.scanImageSelected,
                ),
                if (_showTranslation) _translationLayer(context),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _translationLayer(BuildContext context) {
    if (widget.translatedBlocks.isEmpty) {
      return Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          width: double.infinity,
          color: Colors.black.withValues(alpha: 0.76),
          padding: const EdgeInsets.all(12),
          child: Text(
            widget.translatedText,
            style: const TextStyle(color: Colors.white, fontSize: 16),
          ),
        ),
      );
    }
    return LayoutBuilder(
      builder: (context, constraints) {
        return Stack(
          children: widget.translatedBlocks.map((block) {
            final bounds = block.source;
            return Positioned(
              left: bounds.left * constraints.maxWidth,
              top: bounds.top * constraints.maxHeight,
              width: bounds.width * constraints.maxWidth,
              height: bounds.height * constraints.maxHeight,
              child: Container(
                color: Theme.of(context)
                    .colorScheme
                    .surface
                    .withValues(alpha: 0.92),
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    block.translation,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onSurface,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            );
          }).toList(growable: false),
        );
      },
    );
  }
}

class ScanTextComparisonView extends StatelessWidget {
  const ScanTextComparisonView({
    required this.sourceText,
    required this.translatedText,
    required this.translatedBlocks,
    super.key,
  });

  final String sourceText;
  final String translatedText;
  final List<ScanTranslatedBlock> translatedBlocks;

  @override
  Widget build(BuildContext context) {
    final pairs = translatedBlocks.isEmpty
        ? <(String, String)>[(sourceText, translatedText)]
        : translatedBlocks
            .map((block) => (block.source.text, block.translation))
            .toList(growable: false);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          context.l10n.scanStatusMessage('scanTextComparison'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        for (var index = 0; index < pairs.length; index++) ...<Widget>[
          SelectableText(
            pairs[index].$1,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 4),
          SelectableText(
            pairs[index].$2,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          if (index != pairs.length - 1) const Divider(height: 24),
        ],
      ],
    );
  }
}
