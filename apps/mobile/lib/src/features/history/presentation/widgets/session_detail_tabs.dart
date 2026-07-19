import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';
import '../../data/session_review.dart';
import 'session_action_items_tab.dart';
import 'session_minutes_tab.dart';
import 'session_transcript_tab.dart';

class SessionDetailTabs extends StatelessWidget {
  const SessionDetailTabs({
    required this.detail,
    required this.confirmedTermIds,
    required this.pendingTermKeys,
    required this.pendingActionIndexes,
    required this.onConfirmTerm,
    required this.onRevokeTerm,
    required this.onUpdateActionItem,
    required this.onGenerateReview,
    required this.generatingReview,
    super.key,
  });

  final SessionDetail detail;
  final Map<String, String> confirmedTermIds;
  final Set<String> pendingTermKeys;
  final Set<int> pendingActionIndexes;
  final ValueChanged<SessionTermSuggestion> onConfirmTerm;
  final ValueChanged<SessionTermSuggestion> onRevokeTerm;
  final UpdateSessionActionItem onUpdateActionItem;
  final VoidCallback onGenerateReview;
  final bool generatingReview;

  @override
  Widget build(BuildContext context) {
    final review = buildSessionReview(detail);
    final chinese = context.l10n.isChinese;
    return DefaultTabController(
      length: 3,
      child: Column(
        children: <Widget>[
          TabBar(
            tabs: <Widget>[
              Tab(text: chinese ? '字幕' : 'Transcript'),
              Tab(text: chinese ? '纪要' : 'Notes'),
              Tab(text: chinese ? '待办' : 'Actions'),
            ],
          ),
          Expanded(
            child: TabBarView(
              children: <Widget>[
                SessionTranscriptTab(segments: detail.segments),
                SessionMinutesTab(
                  review: review,
                  hasServerReview: detail.reviewJson != null,
                  confirmedTermIds: confirmedTermIds,
                  pendingTermKeys: pendingTermKeys,
                  onConfirmTerm: onConfirmTerm,
                  onRevokeTerm: onRevokeTerm,
                  onGenerateReview: onGenerateReview,
                  generatingReview: generatingReview,
                ),
                SessionActionItemsTab(
                  items: review.actionItems,
                  hasServerReview: detail.reviewJson != null,
                  pendingIndexes: pendingActionIndexes,
                  onChanged: onUpdateActionItem,
                  onGenerateReview: onGenerateReview,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
