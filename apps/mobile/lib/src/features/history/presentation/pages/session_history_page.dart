import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';
import '../../data/session_history_repository.dart';
import 'session_detail_page.dart';

class SessionHistoryPage extends StatefulWidget {
  const SessionHistoryPage({
    this.repository,
    super.key,
  });

  final SessionHistoryRepository? repository;

  @override
  State<SessionHistoryPage> createState() => _SessionHistoryPageState();
}

class _SessionHistoryPageState extends State<SessionHistoryPage> {
  late final SessionHistoryRepository _repository = widget.repository ??
      SessionHistoryRepository.fromConfig(AppConfig.fromEnvironment());
  late final bool _ownsRepository = widget.repository == null;
  final TextEditingController _searchController = TextEditingController();
  late Future<List<SessionListItem>> _sessions = _repository.listSessions();

  @override
  void dispose() {
    _searchController.dispose();
    if (_ownsRepository) _repository.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.history),
        actions: <Widget>[
          IconButton(
            onPressed: _reload,
            icon: const Icon(Icons.refresh),
            tooltip: context.l10n.refresh,
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _searchController.text.isEmpty
                    ? null
                    : IconButton(
                        onPressed: _clearSearch,
                        icon: const Icon(Icons.clear),
                        tooltip: context.l10n.clear,
                      ),
                hintText: context.l10n.search,
              ),
              textInputAction: TextInputAction.search,
              onChanged: (_) => _reload(),
            ),
          ),
          Expanded(
            child: FutureBuilder<List<SessionListItem>>(
              future: _sessions,
              builder: (context, snapshot) {
                if (snapshot.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snapshot.hasError) {
                  return Center(
                    child: Text(context.l10n.errorMessage(snapshot.error!)),
                  );
                }
                final sessions = snapshot.data!;
                if (sessions.isEmpty) {
                  return Center(child: Text(context.l10n.noSessionsYet));
                }
                return ListView.builder(
                  itemCount: sessions.length,
                  itemBuilder: (context, index) => _SessionTile(
                    session: sessions[index],
                    onDeleted: _deleteSession,
                    onOpened: _openSession,
                    onReviewOpened: _openReview,
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _reload() {
    setState(() {
      _sessions = _repository.listSessions(query: _searchController.text);
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _reload();
  }

  Future<void> _openSession(String sessionId) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SessionDetailPage(
          sessionId: sessionId,
          repository: _repository,
        ),
      ),
    );
    if (mounted) _reload();
  }

  Future<void> _openReview(String sessionId) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SessionDetailPage(
          sessionId: sessionId,
          repository: _repository,
          autoGenerateReview: true,
        ),
      ),
    );
    if (mounted) _reload();
  }

  Future<void> _deleteSession(String sessionId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(context.l10n.deleteSession),
        content: Text(context.l10n.deleteSessionBody),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(context.l10n.cancel),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(context.l10n.delete),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _repository.deleteSession(sessionId);
    if (mounted) _reload();
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({
    required this.session,
    required this.onDeleted,
    required this.onOpened,
    required this.onReviewOpened,
  });

  final SessionListItem session;
  final ValueChanged<String> onDeleted;
  final ValueChanged<String> onOpened;
  final ValueChanged<String> onReviewOpened;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: ListTile(
        title: Text(session.createdAt.toLocal().toString()),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                l10n.sessionSummary(
                  status: session.status,
                  consumedSeconds: session.consumedSeconds,
                  segmentCount: session.segmentCount,
                ),
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: <Widget>[
                  TextButton.icon(
                    onPressed: session.segmentCount == 0
                        ? null
                        : () => onReviewOpened(session.sessionId),
                    icon: const Icon(Icons.summarize_outlined),
                    label: Text(l10n.meetingMinutes),
                  ),
                  TextButton.icon(
                    onPressed: () => onOpened(session.sessionId),
                    icon: const Icon(Icons.subject_outlined),
                    label: Text(l10n.transcript),
                  ),
                ],
              ),
            ],
          ),
        ),
        trailing: IconButton(
          onPressed: () => onDeleted(session.sessionId),
          icon: const Icon(Icons.delete_outline),
          tooltip: l10n.delete,
        ),
        onTap: () => onOpened(session.sessionId),
      ),
    );
  }
}
