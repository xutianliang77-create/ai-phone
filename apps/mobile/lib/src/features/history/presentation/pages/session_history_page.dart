import 'dart:async';

import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../data/session_history_models.dart';
import '../../data/session_history_repository.dart';
import '../widgets/session_history_sections.dart';
import 'session_detail_page.dart';

class SessionHistoryPage extends StatefulWidget {
  const SessionHistoryPage({this.repository, super.key});

  final SessionHistoryRepository? repository;

  @override
  State<SessionHistoryPage> createState() => _SessionHistoryPageState();
}

class _SessionHistoryPageState extends State<SessionHistoryPage> {
  static const _searchDebounceDuration = Duration(milliseconds: 300);

  late final SessionHistoryRepository _repository = widget.repository ??
      SessionHistoryRepository.fromConfig(AppConfig.fromEnvironment());
  late final bool _ownsRepository = widget.repository == null;
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounceTimer;
  late Future<List<SessionListItem>> _sessions = _repository.listSessions();
  SessionHistoryKind _kind = SessionHistoryKind.realtime;
  bool _showSearch = false;
  bool _endedOnly = true;

  @override
  void dispose() {
    _searchDebounceTimer?.cancel();
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
            onPressed: _toggleSearch,
            icon: Icon(_showSearch ? Icons.close : Icons.search),
            tooltip: _showSearch ? context.l10n.clear : context.l10n.search,
          ),
          PopupMenuButton<bool>(
            icon: const Icon(Icons.filter_alt_outlined),
            tooltip: _text('筛选', 'Filter'),
            initialValue: _endedOnly,
            onSelected: (value) => setState(() => _endedOnly = value),
            itemBuilder: (context) => <PopupMenuEntry<bool>>[
              PopupMenuItem(value: true, child: Text(_text('已结束', 'Ended'))),
              PopupMenuItem(value: false, child: Text(_text('全部状态', 'All'))),
            ],
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          SessionHistoryKindSelector(
            selected: _kind,
            onSelected: (kind) => setState(() => _kind = kind),
          ),
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 180),
            child: !_showSearch
                ? const SizedBox.shrink()
                : Padding(
                    key: const ValueKey('history-search'),
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
                    child: TextField(
                      controller: _searchController,
                      autofocus: true,
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search),
                        hintText: context.l10n.search,
                      ),
                      textInputAction: TextInputAction.search,
                      onChanged: (_) => _scheduleReload(),
                      onSubmitted: (_) => _reload(),
                    ),
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
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            context.l10n.errorMessage(snapshot.error!),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: _reload,
                            icon: const Icon(Icons.refresh),
                            label: Text(_text('重试', 'Retry')),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                final sessions = snapshot.data!
                    .where((session) => session.kind == _kind.name)
                    .where(
                        (session) => !_endedOnly || session.status == 'ended' ||
                          session.status == 'checkpoint')
                    .toList(growable: false);
                if (sessions.isEmpty) {
                  return SessionHistoryEmptyState(kind: _kind);
                }
                return SessionHistorySections(
                  sessions: sessions,
                  onOpened: _openSession,
                  onReviewOpened: _openReview,
                  onDeleted: _deleteSession,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _text(String zh, String en) => context.l10n.isChinese ? zh : en;

  void _reload() {
    _searchDebounceTimer?.cancel();
    _searchDebounceTimer = null;
    setState(() {
      _sessions = _repository.listSessions(query: _searchController.text);
    });
  }

  void _scheduleReload() {
    _searchDebounceTimer?.cancel();
    _searchDebounceTimer = Timer(_searchDebounceDuration, () {
      _searchDebounceTimer = null;
      if (mounted) _reload();
    });
  }

  void _toggleSearch() {
    final closing = _showSearch;
    if (closing) {
      _searchDebounceTimer?.cancel();
      _searchDebounceTimer = null;
      _searchController.clear();
    }
    setState(() {
      _showSearch = !closing;
      if (closing) _sessions = _repository.listSessions();
    });
  }

  Future<void> _openSession(String sessionId) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => SessionDetailPage(
        sessionId: sessionId,
        repository: _repository,
        initialTranscriptQuery: _searchController.text.trim(),
      ),
    ));
    if (mounted) _reload();
  }

  Future<void> _openReview(String sessionId) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => SessionDetailPage(
        sessionId: sessionId,
        repository: _repository,
        autoGenerateReview: true,
      ),
    ));
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
