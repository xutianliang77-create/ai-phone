import 'package:flutter/material.dart';

import '../../../../app/app_config.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../shared/domain/speaker_attribution.dart';
import '../../data/session_history_models.dart';
import '../../data/session_history_repository.dart';
import '../../data/session_review.dart';
import '../widgets/session_detail_overview.dart';
import '../widgets/session_detail_tabs.dart';
import '../widgets/session_terms_tab.dart';
import '../widgets/session_speakers_panel.dart';

class SessionDetailPage extends StatefulWidget {
  const SessionDetailPage({
    required this.sessionId,
    this.repository,
    this.autoGenerateReview = false,
    super.key,
  });

  final String sessionId;
  final SessionHistoryRepository? repository;
  final bool autoGenerateReview;

  @override
  State<SessionDetailPage> createState() => _SessionDetailPageState();
}

class _SessionDetailPageState extends State<SessionDetailPage> {
  late final SessionHistoryRepository _repository = widget.repository ??
      SessionHistoryRepository.fromConfig(AppConfig.fromEnvironment());
  late final bool _ownsRepository = widget.repository == null;
  late Future<SessionDetail> _detail;
  SessionDetail? _currentDetail;
  bool _exporting = false;
  bool _generatingReview = false;
  final Map<String, String> _confirmedTermIds = <String, String>{};
  final Set<String> _pendingTermKeys = <String>{};
  final Set<int> _pendingActionIndexes = <int>{};
  bool _queuedInitialReview = false;

  @override
  void initState() {
    super.initState();
    _detail = _repository.getSession(widget.sessionId);
    if (widget.autoGenerateReview) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _queuedInitialReview) return;
        _queuedInitialReview = true;
        _generateReview();
      });
    }
  }

  @override
  void dispose() {
    if (_ownsRepository) _repository.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(context.l10n.sessionDetail),
        actions: <Widget>[
          IconButton(
            icon: _generatingReview
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.auto_awesome_outlined),
            tooltip: context.l10n.generateReview,
            onPressed: _generatingReview ? null : _generateReview,
          ),
          PopupMenuButton<String>(
            enabled: !_exporting,
            icon: const Icon(Icons.ios_share),
            tooltip: context.l10n.export,
            onSelected: _shareExport,
            itemBuilder: (context) => <PopupMenuEntry<String>>[
              PopupMenuItem(
                value: 'markdown',
                child: Text(context.l10n.exportMarkdown),
              ),
              PopupMenuItem(
                value: 'txt',
                child: Text(context.l10n.exportText),
              ),
              PopupMenuItem(
                value: 'json',
                child: Text(context.l10n.exportJson),
              ),
              PopupMenuItem(
                value: 'csv',
                child: Text(context.l10n.exportCsv),
              ),
            ],
          ),
        ],
      ),
      body: FutureBuilder<SessionDetail>(
        future: _detail,
        builder: (context, snapshot) {
          if (_currentDetail == null &&
              snapshot.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (_currentDetail == null && snapshot.hasError) {
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
                      onPressed: _reloadDetail,
                      icon: const Icon(Icons.refresh),
                      label: Text(context.l10n.isChinese ? '重试' : 'Retry'),
                    ),
                  ],
                ),
              ),
            );
          }
          final detail = _currentDetail ?? snapshot.data!;
          return Column(
            children: <Widget>[
              SessionDetailOverview(
                detail: detail,
                onManageSpeakers: detail.speakerCount == 0
                    ? null
                    : () => _showSpeakers(detail),
              ),
              Expanded(
                child: SessionDetailTabs(
                  detail: detail,
                  confirmedTermIds: _confirmedTermIds,
                  pendingTermKeys: _pendingTermKeys,
                  pendingActionIndexes: _pendingActionIndexes,
                  onConfirmTerm: _confirmTerm,
                  onRevokeTerm: _revokeTerm,
                  onUpdateActionItem: _updateActionItem,
                  onGenerateReview: _generateReview,
                  generatingReview: _generatingReview,
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  void _reloadDetail() {
    setState(() {
      _detail = _repository.getSession(widget.sessionId);
    });
  }

  Future<void> _shareExport(String format) async {
    setState(() => _exporting = true);
    try {
      await _repository.shareExport(widget.sessionId, format: format);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  Future<void> _generateReview() async {
    setState(() => _generatingReview = true);
    try {
      final detail = await _repository.generateReview(widget.sessionId);
      if (!mounted) return;
      setState(() => _currentDetail = detail);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.reviewGenerated)),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.l10n.errorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _generatingReview = false);
    }
  }

  Future<void> _renameSpeaker(
    SpeakerAttribution speaker,
    String displayName,
  ) async {
    final updated = await _repository.renameSpeaker(
      widget.sessionId,
      speaker.speakerId,
      displayName,
    );
    if (!mounted) return;
    setState(() => _currentDetail = updated);
  }

  Future<void> _updateActionItem(int index, bool completed) async {
    setState(() => _pendingActionIndexes.add(index));
    try {
      final updated = await _repository.updateActionItem(
        widget.sessionId,
        index,
        completed,
      );
      if (!mounted) return;
      setState(() => _currentDetail = updated);
    } catch (error) {
      if (mounted) _showError(error);
    } finally {
      if (mounted) setState(() => _pendingActionIndexes.remove(index));
    }
  }

  Future<void> _showSpeakers(SessionDetail detail) {
    return showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: SingleChildScrollView(
          child: SessionSpeakersPanel(detail: detail, onRename: _renameSpeaker),
        ),
      ),
    );
  }

  Future<void> _confirmTerm(SessionTermSuggestion term) async {
    final key = sessionTermKey(term);
    setState(() => _pendingTermKeys.add(key));
    try {
      final saved = await _repository.confirmTerm(
        sessionId: widget.sessionId,
        sourceText: term.sourceText,
        translatedText: term.translatedText,
      );
      if (!mounted) return;
      setState(() => _confirmedTermIds[key] = saved.id);
      _showTermMessage('术语已确认', 'Term confirmed');
    } catch (error) {
      if (!mounted) return;
      _showError(error);
    } finally {
      if (mounted) setState(() => _pendingTermKeys.remove(key));
    }
  }

  Future<void> _revokeTerm(SessionTermSuggestion term) async {
    final key = sessionTermKey(term);
    final termId = _confirmedTermIds[key];
    if (termId == null) return;
    setState(() => _pendingTermKeys.add(key));
    try {
      await _repository.revokeTerm(termId);
      if (!mounted) return;
      setState(() => _confirmedTermIds.remove(key));
      _showTermMessage('术语已撤销', 'Term revoked');
    } catch (error) {
      if (!mounted) return;
      _showError(error);
    } finally {
      if (mounted) setState(() => _pendingTermKeys.remove(key));
    }
  }

  void _showTermMessage(String zh, String en) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.isChinese ? zh : en)),
    );
  }

  void _showError(Object error) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(context.l10n.errorMessage(error))),
    );
  }
}
