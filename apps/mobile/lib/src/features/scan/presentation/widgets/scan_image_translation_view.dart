import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/scan_translation_controller.dart';
import 'scan_translation_layout_policy.dart';
import 'scan_translation_overlay_layout.dart';

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
  static const double _minScale = 1;
  static const double _maxScale = 5;
  static const double _zoomControlsInset = 8;
  static const double _zoomControlsWidth = 144;
  static const double _zoomControlsHeight = 48;
  static const TextScaler _maximumOverlayTextScaler = TextScaler.linear(1.1);

  final TransformationController _transformationController =
      TransformationController();
  bool _showTranslation = false;
  double _scale = _minScale;

  bool get _hasTranslation => widget.translatedText.trim().isNotEmpty;

  @override
  void didUpdateWidget(covariant ScanImageTranslationView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.translatedText.isEmpty && _hasTranslation) {
      _showTranslation = true;
    }
  }

  @override
  void dispose() {
    _transformationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final useListFallback =
        shouldUseScanTranslationListFallback(widget.translatedBlocks);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Wrap(
          spacing: 12,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: <Widget>[
            Text(
              l10n.scanStatusMessage('scanImageComparison'),
              style: Theme.of(context).textTheme.titleMedium,
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
            child: LayoutBuilder(
              builder: (context, constraints) {
                final viewport = constraints.biggest;
                return Stack(
                  fit: StackFit.expand,
                  children: <Widget>[
                    InteractiveViewer(
                      transformationController: _transformationController,
                      minScale: _minScale,
                      maxScale: _maxScale,
                      onInteractionUpdate: (_) => _syncScale(),
                      child: SizedBox(
                        width: viewport.width,
                        height: viewport.height,
                        child: Stack(
                          fit: StackFit.expand,
                          children: <Widget>[
                            Image.memory(
                              widget.imageBytes,
                              fit: BoxFit.fill,
                              semanticLabel: l10n.scanImageSelected,
                            ),
                            if (_showTranslation && !useListFallback)
                              _translationLayer(context),
                          ],
                        ),
                      ),
                    ),
                    Positioned(
                      right: _zoomControlsInset,
                      bottom: _zoomControlsInset,
                      child: _ZoomControls(
                        scale: _scale,
                        minScale: _minScale,
                        maxScale: _maxScale,
                        onZoomOut: () => _setScale(_scale / 1.5, viewport),
                        onReset: () => _setScale(_minScale, viewport),
                        onZoomIn: () => _setScale(_scale * 1.5, viewport),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
        if (_showTranslation && useListFallback) ...<Widget>[
          const SizedBox(height: 8),
          Container(
            key: const ValueKey('scan-translation-list-fallback-notice'),
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.secondaryContainer,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              l10n.isChinese
                  ? '版面较密，译文已移到下方列表。点按条目可展开全文。'
                  : 'Dense layout: translation is in the list below. Tap to expand.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: Theme.of(context).colorScheme.onSecondaryContainer,
                  ),
            ),
          ),
        ],
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
        final overlayTextScaler = _overlayTextScaler(context);
        final placements = layoutScanTranslationOverlays(
          blocks: widget.translatedBlocks,
          canvas: constraints.biggest,
          textDirection: Directionality.of(context),
          textScaler: overlayTextScaler,
          reservedRect: Rect.fromLTWH(
            constraints.maxWidth - _zoomControlsInset - _zoomControlsWidth,
            constraints.maxHeight - _zoomControlsInset - _zoomControlsHeight,
            _zoomControlsWidth,
            _zoomControlsHeight,
          ),
        );
        return Stack(
          children: <Widget>[
            for (var index = 0; index < placements.length; index++)
              Builder(builder: (context) {
                final placement = placements[index];
                final rect = placement.rect;
                return Positioned(
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                  child: Container(
                    key: ValueKey('scan-translation-overlay-$index'),
                    color: Theme.of(context)
                        .colorScheme
                        .surface
                        .withValues(alpha: 0.88),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 3, vertical: 2),
                    child: Text(
                      placement.block.translation,
                      maxLines: scanTranslationOverlayMaxLines,
                      overflow: TextOverflow.ellipsis,
                      textScaler: overlayTextScaler,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.onSurface,
                        fontSize: placement.fontSize,
                        height: 1.1,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                );
              }),
          ],
        );
      },
    );
  }

  TextScaler _overlayTextScaler(BuildContext context) {
    final ambient = MediaQuery.textScalerOf(context);
    return ambient.scale(14) <= _maximumOverlayTextScaler.scale(14)
        ? ambient
        : _maximumOverlayTextScaler;
  }

  void _syncScale() {
    final nextScale = _transformationController.value.getMaxScaleOnAxis();
    if ((nextScale - _scale).abs() < 0.01 || !mounted) return;
    setState(() => _scale = nextScale);
  }

  void _setScale(double requestedScale, Size viewport) {
    final targetScale = requestedScale.clamp(_minScale, _maxScale);
    final focalPoint = viewport.center(Offset.zero);
    final scenePoint = _transformationController.toScene(focalPoint);
    _transformationController.value = Matrix4.identity()
      ..translateByDouble(focalPoint.dx, focalPoint.dy, 0, 1)
      ..scaleByDouble(targetScale, targetScale, 1, 1)
      ..translateByDouble(-scenePoint.dx, -scenePoint.dy, 0, 1);
    setState(() => _scale = targetScale);
  }
}

class _ZoomControls extends StatelessWidget {
  const _ZoomControls({
    required this.scale,
    required this.minScale,
    required this.maxScale,
    required this.onZoomOut,
    required this.onReset,
    required this.onZoomIn,
  });

  final double scale;
  final double minScale;
  final double maxScale;
  final VoidCallback onZoomOut;
  final VoidCallback onReset;
  final VoidCallback onZoomIn;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.92),
      borderRadius: BorderRadius.circular(6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          IconButton(
            tooltip: '缩小图片',
            onPressed: scale > minScale ? onZoomOut : null,
            icon: const Icon(Icons.zoom_out),
          ),
          IconButton(
            tooltip: '恢复原始大小',
            onPressed: scale > minScale ? onReset : null,
            icon: const Icon(Icons.center_focus_strong),
          ),
          IconButton(
            tooltip: '放大图片',
            onPressed: scale < maxScale ? onZoomIn : null,
            icon: const Icon(Icons.zoom_in),
          ),
        ],
      ),
    );
  }
}
