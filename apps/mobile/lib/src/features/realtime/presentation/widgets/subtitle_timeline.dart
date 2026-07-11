import 'package:flutter/material.dart';

import '../../../../app/localization/app_localizations.dart';
import '../../../../shared/widgets/auto_follow_scroll_view.dart';
import '../../../realtime/domain/entities/subtitle_segment.dart';

class SubtitleTimeline extends StatefulWidget {
  const SubtitleTimeline({required this.segments, super.key});

  final List<SubtitleSegment> segments;

  @override
  State<SubtitleTimeline> createState() => _SubtitleTimelineState();
}

class _SubtitleTimelineState extends State<SubtitleTimeline> {
  int _lastSegmentCount = 0;
  String _lastTailKey = '';

  @override
  void initState() {
    super.initState();
    _rememberTail();
  }

  @override
  Widget build(BuildContext context) {
    if (widget.segments.isEmpty) {
      return Center(child: Text(context.l10n.tapStartToBegin));
    }
    _rememberTail();
    return AutoFollowScrollView(
      tailKey: '$_lastSegmentCount|$_lastTailKey',
      jumpToLatestLabel: context.l10n.isChinese ? '回到底部' : 'Back to latest',
      children: <Widget>[
        for (final segment in widget.segments)
          ListTile(
            title: Text(segment.sourceText),
            subtitle: Text(segment.translatedText),
          ),
      ],
    );
  }

  void _rememberTail() {
    _lastSegmentCount = widget.segments.length;
    if (widget.segments.isEmpty) {
      _lastTailKey = '';
      return;
    }
    final tail = widget.segments.last;
    _lastTailKey = '${tail.id}|${tail.sourceText}|${tail.translatedText}';
  }
}
