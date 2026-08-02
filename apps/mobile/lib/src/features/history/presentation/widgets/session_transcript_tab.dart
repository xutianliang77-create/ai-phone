import 'package:flutter/material.dart';

import '../../../../app/localization/app_history_localizations.dart';
import '../../../../app/localization/app_localizations.dart';
import '../../../../app/localization/app_realtime_timeline_localizations.dart';
import '../../data/session_history_models.dart';

class SessionTranscriptTab extends StatefulWidget {
  const SessionTranscriptTab({required this.segments, super.key});

  final List<SessionSegment> segments;

  @override
  State<SessionTranscriptTab> createState() => _SessionTranscriptTabState();
}

class _SessionTranscriptTabState extends State<SessionTranscriptTab> {
  final TextEditingController _searchController = TextEditingController();
  final Set<String> _expandedRawSegmentIds = <String>{};
  bool _showSearch = false;
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.segments.isEmpty) {
      return Center(child: Text(context.l10n.noSavedSubtitles));
    }
    final visibleSegments =
        widget.segments.where(_matchesQuery).toList(growable: false);
    final searching = _query.trim().isNotEmpty;
    final countText = searching
        ? context.l10n.transcriptSearchResultCount(
            matches: visibleSegments.length,
            total: widget.segments.length,
          )
        : context.l10n.transcriptSegmentCount(widget.segments.length);
    return Column(
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 2, 4, 2),
          child: Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  countText,
                  key: const ValueKey('transcript-segment-count'),
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              IconButton(
                key: const ValueKey('transcript-search-toggle'),
                onPressed: _toggleSearch,
                tooltip: _showSearch
                    ? context.l10n.clear
                    : context.l10n.searchTranscript,
                icon: Icon(_showSearch ? Icons.close : Icons.search),
              ),
            ],
          ),
        ),
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          child: !_showSearch
              ? const SizedBox.shrink()
              : Padding(
                  key: const ValueKey('transcript-search'),
                  padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
                  child: TextField(
                    key: const ValueKey('transcript-search-field'),
                    controller: _searchController,
                    autofocus: true,
                    maxLines: 1,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: context.l10n.searchTranscript,
                      suffixIcon: searching
                          ? IconButton(
                              key: const ValueKey(
                                'transcript-search-clear-icon',
                              ),
                              onPressed: _clearSearch,
                              tooltip: context.l10n.clear,
                              icon: const Icon(Icons.clear),
                            )
                          : null,
                    ),
                    onChanged: (value) => setState(() => _query = value),
                  ),
                ),
        ),
        Expanded(
          child: visibleSegments.isEmpty
              ? _NoTranscriptMatches(onClear: _clearSearch)
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                  itemCount: visibleSegments.length,
                  separatorBuilder: (_, __) => const Divider(height: 20),
                  itemBuilder: (context, index) {
                    return _buildSegment(context, visibleSegments[index]);
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildSegment(BuildContext context, SessionSegment segment) {
    final optimized = _preferredSourceText(segment);
    final hasOptimization = _hasOptimization(segment);
    final rawExpanded = _expandedRawSegmentIds.contains(segment.id);
    final metadata = <String>[
      if (segment.speaker != null)
        segment.speaker!.label(isChinese: context.l10n.isChinese),
      if (segment.timing?.overlap == true) context.l10n.overlappingSpeech,
      if (segment.languageProfile?.mixedLanguage == true)
        context.l10n.mixedLanguage,
      if (hasOptimization) context.l10n.optimizedRecognition,
    ];
    return KeyedSubtree(
      key: ValueKey('transcript-segment-${segment.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (metadata.isNotEmpty) ...<Widget>[
            Text(
              metadata.join(' · '),
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
            ),
            const SizedBox(height: 6),
          ],
          SelectableText(
            optimized,
            style: Theme.of(context).textTheme.titleMedium,
          ),
          if (segment.translatedText.trim().isNotEmpty) ...<Widget>[
            const SizedBox(height: 6),
            SelectableText(
              segment.translatedText,
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          ],
          if (hasOptimization) ...<Widget>[
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                key: ValueKey('transcript-raw-toggle-${segment.id}'),
                onPressed: () => _toggleRaw(segment.id),
                icon: Icon(
                  rawExpanded ? Icons.expand_less : Icons.expand_more,
                ),
                label: Text(
                  rawExpanded
                      ? context.l10n.hideRawRecognition
                      : context.l10n.showRawRecognition,
                ),
              ),
            ),
            if (rawExpanded)
              Padding(
                padding: const EdgeInsets.only(left: 12, bottom: 4),
                child: SelectableText(
                  segment.rawText!.trim(),
                  key: ValueKey('transcript-raw-${segment.id}'),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ],
      ),
    );
  }

  bool _hasOptimization(SessionSegment segment) {
    final raw = segment.rawText?.trim();
    final optimized = _preferredSourceText(segment);
    return raw != null &&
        raw.isNotEmpty &&
        optimized.isNotEmpty &&
        raw != optimized;
  }

  String _preferredSourceText(SessionSegment segment) {
    final optimized = segment.optimizedText?.trim();
    return optimized?.isNotEmpty == true ? optimized! : segment.sourceText;
  }

  bool _matchesQuery(SessionSegment segment) {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return true;
    return <String>[
      segment.sourceText,
      segment.optimizedText ?? '',
      segment.rawText ?? '',
      segment.translatedText,
    ].any((text) => text.toLowerCase().contains(query));
  }

  void _toggleSearch() {
    if (_showSearch) {
      _searchController.clear();
      _query = '';
    }
    setState(() => _showSearch = !_showSearch);
  }

  void _clearSearch() {
    _searchController.clear();
    setState(() => _query = '');
  }

  void _toggleRaw(String segmentId) {
    setState(() {
      if (!_expandedRawSegmentIds.add(segmentId)) {
        _expandedRawSegmentIds.remove(segmentId);
      }
    });
  }
}

class _NoTranscriptMatches extends StatelessWidget {
  const _NoTranscriptMatches({required this.onClear});

  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(context.l10n.noTranscriptMatches),
          const SizedBox(height: 8),
          TextButton(
            key: const ValueKey('transcript-search-clear'),
            onPressed: onClear,
            child: Text(context.l10n.clear),
          ),
        ],
      ),
    );
  }
}
