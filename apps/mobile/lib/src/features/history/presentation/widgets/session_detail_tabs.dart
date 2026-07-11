import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';
import '../../data/session_review.dart';
import 'session_terms_tab.dart';

class SessionDetailTabs extends StatelessWidget {
  const SessionDetailTabs({
    required this.detail,
    required this.confirmedTermIds,
    required this.pendingTermKeys,
    required this.onConfirmTerm,
    required this.onRevokeTerm,
    super.key,
  });

  final SessionDetail detail;
  final Map<String, String> confirmedTermIds;
  final Set<String> pendingTermKeys;
  final ValueChanged<SessionTermSuggestion> onConfirmTerm;
  final ValueChanged<SessionTermSuggestion> onRevokeTerm;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final review = buildSessionReview(detail);
    return DefaultTabController(
      length: 4,
      child: Column(
        children: <Widget>[
          TabBar(
            tabs: <Widget>[
              Tab(text: l10n.summary),
              Tab(text: l10n.highlights),
              Tab(text: l10n.transcript),
              Tab(text: l10n.terms),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: <Widget>[
                _SummaryTab(review: review),
                _HighlightsTab(highlights: review.highlights),
                _TranscriptTab(segments: detail.segments),
                SessionTermsTab(
                  terms: review.terms,
                  confirmedTermIds: confirmedTermIds,
                  pendingTermKeys: pendingTermKeys,
                  onConfirm: onConfirmTerm,
                  onRevoke: onRevokeTerm,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryTab extends StatelessWidget {
  const _SummaryTab({required this.review});

  final SessionReview review;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: <Widget>[
        if (review.title != null) ...<Widget>[
          Text(
            review.title!,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 12),
        ],
        SelectableText(
          review.summary.isEmpty
              ? context.l10n.noSavedSubtitles
              : review.summary,
        ),
        _ReviewSection(title: '结论', items: review.decisions),
        _ActionItemSection(items: review.actionItems),
        _KeyFactSection(items: review.keyFacts),
        _ReviewSection(title: '风险', items: review.risks),
        _ReviewSection(title: '待确认', items: review.openQuestions),
      ],
    );
  }
}

class _ReviewSection extends StatelessWidget {
  const _ReviewSection({required this.title, required this.items});

  final String title;
  final List<String> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          ...items.map((item) => Text('• $item')),
        ],
      ),
    );
  }
}

class _ActionItemSection extends StatelessWidget {
  const _ActionItemSection({required this.items});

  final List<SessionActionItem> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('待办', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          ...items.map((item) {
            final owner = item.owner == null ? '' : '（${item.owner}）';
            final due = item.dueDate == null ? '' : ' ${item.dueDate}';
            return Text('• ${item.text}$owner$due');
          }),
        ],
      ),
    );
  }
}

class _KeyFactSection extends StatelessWidget {
  const _KeyFactSection({required this.items});

  final List<SessionKeyFact> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('关键事实', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 6),
          ...items.map((item) => Text('• ${item.type}: ${item.text}')),
        ],
      ),
    );
  }
}

class _HighlightsTab extends StatelessWidget {
  const _HighlightsTab({required this.highlights});

  final List<SessionHighlight> highlights;

  @override
  Widget build(BuildContext context) {
    if (highlights.isEmpty) {
      return Center(child: Text(context.l10n.noHighlights));
    }
    return ListView.builder(
      itemCount: highlights.length,
      itemBuilder: (context, index) {
        final highlight = highlights[index];
        return ListTile(
          leading: const Icon(Icons.auto_awesome_outlined),
          title: Text(context.l10n.diagnosticsValue(highlight.type)),
          subtitle: Text(highlight.text),
        );
      },
    );
  }
}

class _TranscriptTab extends StatelessWidget {
  const _TranscriptTab({required this.segments});

  final List<SessionSegment> segments;

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      itemCount: segments.length,
      itemBuilder: (context, index) {
        final segment = segments[index];
        return ListTile(
          title: Text(segment.sourceText),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              if (_hasOptimization(segment)) ...<Widget>[
                const SizedBox(height: 6),
                Text(
                  '原始识别：${segment.rawText}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                Text(
                  '智能优化：${segment.optimizedText}',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
              if (segment.translatedText.trim().isNotEmpty) ...<Widget>[
                const SizedBox(height: 6),
                Text(segment.translatedText),
              ],
              if (segment.refinement != null) ...<Widget>[
                const SizedBox(height: 4),
                Text(
                  _refinementLabel(segment.refinement!),
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              ],
            ],
          ),
        );
      },
    );
  }

  bool _hasOptimization(SessionSegment segment) {
    final raw = segment.rawText?.trim();
    final optimized = segment.optimizedText?.trim();
    return raw != null &&
        raw.isNotEmpty &&
        optimized != null &&
        optimized.isNotEmpty &&
        raw != optimized;
  }

  String _refinementLabel(Map<String, Object?> refinement) {
    final provider = refinement['provider'] as String? ?? 'LLM';
    final confidence = refinement['confidence'];
    final fallback = refinement['fallbackReason'] as String?;
    final confidenceText =
        confidence is num ? '，置信度 ${confidence.toStringAsFixed(2)}' : '';
    final fallbackText = fallback == null ? '' : '，回退 $fallback';
    return '智能优化：$provider$confidenceText$fallbackText';
  }
}
