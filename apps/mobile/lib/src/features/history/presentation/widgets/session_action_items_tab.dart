import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_review.dart';

typedef UpdateSessionActionItem = Future<void> Function(
  int index,
  bool completed,
);

class SessionActionItemsTab extends StatelessWidget {
  const SessionActionItemsTab({
    required this.items,
    required this.hasServerReview,
    required this.pendingIndexes,
    required this.onChanged,
    required this.onGenerateReview,
    super.key,
  });

  final List<SessionActionItem> items;
  final bool hasServerReview;
  final Set<int> pendingIndexes;
  final UpdateSessionActionItem onChanged;
  final VoidCallback onGenerateReview;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    if (!hasServerReview) {
      return _GenerateReviewEmptyState(onGenerateReview: onGenerateReview);
    }
    if (items.isEmpty) {
      return Center(child: Text(chinese ? '本次记录暂无待办事项' : 'No action items'));
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(12, 12, 16, 24),
      itemCount: items.length,
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        final item = items[index];
        final metadata = <String>[
          if (item.owner?.trim().isNotEmpty == true) item.owner!,
          if (item.dueDate?.trim().isNotEmpty == true) item.dueDate!,
        ];
        return CheckboxListTile(
          key: ValueKey('action-item-$index'),
          value: item.completed,
          onChanged: pendingIndexes.contains(index)
              ? null
              : (value) => onChanged(index, value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          title: Text(
            item.text,
            style: item.completed
                ? const TextStyle(decoration: TextDecoration.lineThrough)
                : null,
          ),
          subtitle: metadata.isEmpty ? null : Text(metadata.join(' · ')),
          secondary: pendingIndexes.contains(index)
              ? const SizedBox.square(
                  dimension: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : null,
        );
      },
    );
  }
}

class _GenerateReviewEmptyState extends StatelessWidget {
  const _GenerateReviewEmptyState({required this.onGenerateReview});
  final VoidCallback onGenerateReview;

  @override
  Widget build(BuildContext context) {
    final chinese = context.l10n.isChinese;
    return Center(
      child: FilledButton.icon(
        onPressed: onGenerateReview,
        icon: const Icon(Icons.auto_awesome_outlined),
        label: Text(chinese ? '生成纪要与待办' : 'Generate notes and actions'),
      ),
    );
  }
}
