import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../controllers/scan_translation_controller.dart';
import 'scan_translation_layout_policy.dart';

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
    final useListFallback =
        shouldUseScanTranslationListFallback(translatedBlocks);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          context.l10n.scanStatusMessage('scanTextComparison'),
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        if (useListFallback)
          _DenseComparisonList(pairs: pairs)
        else
          _FlatComparisonList(pairs: pairs),
      ],
    );
  }
}

class _DenseComparisonList extends StatelessWidget {
  const _DenseComparisonList({required this.pairs});

  final List<(String, String)> pairs;

  @override
  Widget build(BuildContext context) {
    final isChinese = context.l10n.isChinese;
    return Column(
      key: const ValueKey('scan-translation-list-fallback'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          isChinese
              ? '版面较密，已切换为列表。点按每项查看完整原文和译文。'
              : 'Dense layout shown as a list. Tap an item for full text.',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
        const SizedBox(height: 8),
        for (var index = 0; index < pairs.length; index++)
          Card(
            margin: const EdgeInsets.only(bottom: 6),
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              key: ValueKey('scan-translation-list-item-$index'),
              title: Text(
                pairs[index].$1,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              subtitle: Text(
                pairs[index].$2,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              expandedCrossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                const Divider(),
                SelectableText(
                  pairs[index].$1,
                  key: ValueKey('scan-translation-list-source-$index'),
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 8),
                SelectableText(
                  pairs[index].$2,
                  key: ValueKey('scan-translation-list-translation-$index'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

class _FlatComparisonList extends StatelessWidget {
  const _FlatComparisonList({required this.pairs});

  final List<(String, String)> pairs;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
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
