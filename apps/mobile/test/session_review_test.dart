import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';
import 'package:translation_mobile/src/features/history/data/session_review.dart';

void main() {
  test('builds local summary highlights and term suggestions', () {
    final review = buildSessionReview(SessionDetail(
      sessionId: 's1',
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 7, 2),
      segmentCount: 3,
      segments: const <SessionSegment>[
        SessionSegment(
          id: '1',
          sourceText: '今天下午三点开会',
          translatedText: 'Meeting at three this afternoon',
        ),
        SessionSegment(
          id: '2',
          sourceText: '预算是2000元',
          translatedText: 'The budget is 2000 yuan',
        ),
        SessionSegment(
          id: '3',
          sourceText: '字幕',
          translatedText: 'subtitles',
        ),
      ],
    ));

    expect(review.summary, contains('Meeting at three this afternoon'));
    expect(review.highlights.map((item) => item.type), contains('time'));
    expect(review.highlights.map((item) => item.type), contains('money'));
    expect(
      review.terms.any((term) =>
          term.sourceText == '字幕' && term.translatedText == 'subtitles'),
      isTrue,
    );
    expect(
      review.keyFacts
          .firstWhere((item) => item.type == 'time')
          .evidenceSegmentIds,
      <String>['1'],
    );
  });

  test('serializes a device rule review with stable source evidence', () {
    final detail = SessionDetail(
      sessionId: 's1',
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 9, 14),
      segmentCount: 1,
      segments: const <SessionSegment>[
        SessionSegment(
          id: 'todo_1',
          sourceText: '请发送会议纪要',
          translatedText: 'Please send the meeting notes',
        ),
      ],
    );

    final review = buildDeviceRuleReviewJson(
      detail,
      DateTime.utc(2026, 9, 14, 8),
    );

    expect(review['generationKind'], 'device_rules');
    expect(review['sourceFingerprint'], matches(RegExp(r'^[a-f0-9]{64}$')));
    expect(review['evidenceSegmentIds'], <String>['todo_1']);
    final persisted = detail.copyWithReview(review);
    expect(isCurrentDeviceRuleReview(persisted), isTrue);
    expect(
      (review['actionItems'] as List<Object?>).single,
      containsPair('evidenceSegmentIds', <String>['todo_1']),
    );
  });

  test('prefers server generated review when available', () {
    final review = buildSessionReview(SessionDetail(
      sessionId: 's1',
      mode: 'meeting',
      status: 'ended',
      consumedSeconds: 60,
      createdAt: DateTime.utc(2026, 7, 2),
      segmentCount: 1,
      reviewJson: const <String, Object?>{
        'summary': '服务端摘要',
        'highlights': <Map<String, Object?>>[
          {'type': 'todo', 'text': '发送会议纪要'},
        ],
        'terms': <Map<String, Object?>>[
          {'sourceText': '端侧翻译', 'translatedText': 'on-device translation'},
        ],
      },
      segments: const <SessionSegment>[
        SessionSegment(
          id: '1',
          sourceText: '今天下午三点开会',
          translatedText: 'Meeting at three this afternoon',
        ),
      ],
    ));

    expect(review.summary, '服务端摘要');
    expect(review.highlights.single.type, 'todo');
    expect(review.terms.single.translatedText, 'on-device translation');
  });
}
