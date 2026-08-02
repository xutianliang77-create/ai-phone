import 'app_localizations.dart';

extension AppHistoryLocalizations on AppLocalizations {
  String get searchTranscript => text('searchTranscript');
  String get noTranscriptMatches => text('noTranscriptMatches');
  String get showRawRecognition => text('showRawRecognition');
  String get hideRawRecognition => text('hideRawRecognition');
  String get optimizedRecognition => text('optimizedRecognition');

  String transcriptSegmentCount(int count) {
    if (isChinese) return '共 $count 段';
    return '$count ${count == 1 ? 'segment' : 'segments'}';
  }

  String transcriptSearchResultCount({
    required int matches,
    required int total,
  }) {
    if (isChinese) return '找到 $matches / $total 段';
    return '$matches of $total ${total == 1 ? 'segment' : 'segments'}';
  }
}
