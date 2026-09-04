import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_review.dart';

class SessionMinutesTab extends StatelessWidget {
  const SessionMinutesTab({
    required this.review,
    required this.hasServerReview,
    required this.onGenerateReview,
    required this.generatingReview,
    super.key,
  });

  final SessionReview review;
  final bool hasServerReview;
  final VoidCallback onGenerateReview;
  final bool generatingReview;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Text(
                review.title ?? (chinese ? '会议纪要' : 'Session notes'),
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            IconButton(
              onPressed: generatingReview ? null : onGenerateReview,
              tooltip: hasServerReview
                  ? (chinese ? '重新生成' : 'Regenerate')
                  : (chinese ? '生成会议纪要' : 'Generate notes'),
              icon: generatingReview
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_awesome_outlined),
            ),
          ],
        ),
        const SizedBox(height: 10),
        SelectableText(
          review.summary.isEmpty
              ? (chinese ? '暂无纪要内容' : 'No notes available')
              : review.summary,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        _StringSection(
            title: chinese ? '结论' : 'Decisions', items: review.decisions),
        _FactSection(items: review.keyFacts),
        _StringSection(title: chinese ? '风险' : 'Risks', items: review.risks),
        _StringSection(
          title: chinese ? '待确认' : 'Open questions',
          items: review.openQuestions,
        ),
        _HighlightSection(items: review.highlights),
      ],
    );
  }
}

class _StringSection extends StatelessWidget {
  const _StringSection({required this.title, required this.items});
  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return _Section(
        title: title, children: items.map((item) => Text('• $item')).toList());
  }
}

class _FactSection extends StatelessWidget {
  const _FactSection({required this.items});
  final List<SessionKeyFact> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return _Section(
      title: context.l10n.isChinese ? '关键信息' : 'Key facts',
      children: items.map((item) => Text('• ${item.text}')).toList(),
    );
  }
}

class _HighlightSection extends StatelessWidget {
  const _HighlightSection({required this.items});
  final List<SessionHighlight> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return _Section(
      title: context.l10n.isChinese ? '重点' : 'Highlights',
      children: items.map((item) => Text('• ${item.text}')).toList(),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children});
  final String title;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          ...children,
        ],
      ),
    );
  }
}
