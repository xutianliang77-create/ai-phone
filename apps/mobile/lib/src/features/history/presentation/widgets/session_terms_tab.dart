import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../data/session_review.dart';

class SessionTermsTab extends StatelessWidget {
  const SessionTermsTab({
    required this.terms,
    required this.confirmedTermIds,
    required this.pendingTermKeys,
    required this.onConfirm,
    required this.onRevoke,
    super.key,
  });

  final List<SessionTermSuggestion> terms;
  final Map<String, String> confirmedTermIds;
  final Set<String> pendingTermKeys;
  final ValueChanged<SessionTermSuggestion> onConfirm;
  final ValueChanged<SessionTermSuggestion> onRevoke;

  @override
  Widget build(BuildContext context) {
    if (terms.isEmpty) {
      return Center(child: Text(context.l10n.noTerms));
    }
    return ListView.builder(
      itemCount: terms.length,
      itemBuilder: (context, index) {
        final term = terms[index];
        final key = sessionTermKey(term);
        final isConfirmed = confirmedTermIds.containsKey(key);
        final isPending = pendingTermKeys.contains(key);
        return ListTile(
          leading: Icon(isConfirmed
              ? Icons.bookmark_added_outlined
              : Icons.bookmark_add_outlined),
          title: Text(term.sourceText),
          subtitle: Text(term.translatedText),
          trailing: _TermActionButton(
            confirmed: isConfirmed,
            pending: isPending,
            onPressed: () => isConfirmed ? onRevoke(term) : onConfirm(term),
          ),
        );
      },
    );
  }
}

class _TermActionButton extends StatelessWidget {
  const _TermActionButton({
    required this.confirmed,
    required this.pending,
    required this.onPressed,
  });

  final bool confirmed;
  final bool pending;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final label = confirmed
        ? (context.l10n.isChinese ? '撤销' : 'Revoke')
        : (context.l10n.isChinese ? '确认' : 'Confirm');
    if (pending) {
      return const SizedBox.square(
        dimension: 24,
        child: CircularProgressIndicator(strokeWidth: 2),
      );
    }
    return TextButton(
      onPressed: onPressed,
      child: Text(label),
    );
  }
}

String sessionTermKey(SessionTermSuggestion term) {
  return '${term.sourceText.trim().toLowerCase()}\n'
      '${term.translatedText.trim().toLowerCase()}';
}
