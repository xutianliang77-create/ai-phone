import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/history/data/session_history_models.dart';

void main() {
  test('orders persisted speaker children by authoritative timing', () {
    final detail = SessionDetail.fromJson(_detailJson(<Map<String, Object?>>[
      _segment('parent', 'speaker_1', 0, 1000),
      _segment('next', 'speaker_2', 1400, 2200),
      _segment('child', 'speaker_2', 1000, 1600),
    ]));

    expect(detail.segments.map((segment) => segment.id), <String>[
      'parent',
      'child',
      'next',
    ]);
  });

  test('keeps persisted order when timing is missing or overlap is explicit',
      () {
    final missingTiming = SessionDetail.fromJson(
      _detailJson(<Map<String, Object?>>[
        _segment('parent', 'speaker_1', 0, 1000),
        <String, Object?>{
          'id': 'untimed',
          'sourceText': 'untimed',
          'translatedText': '',
        },
        _segment('child', 'speaker_2', 500, 800),
      ]),
    );
    final overlap = SessionDetail.fromJson(_detailJson(<Map<String, Object?>>[
      _segment('parent', 'speaker_1', 0, 1000),
      _segment('next', 'speaker_1', 1000, 2000),
      _segment('child', 'speaker_2', 500, 900, overlap: true),
    ]));

    expect(missingTiming.segments.map((segment) => segment.id), <String>[
      'parent',
      'untimed',
      'child',
    ]);
    expect(overlap.segments.map((segment) => segment.id), <String>[
      'parent',
      'next',
      'child',
    ]);
  });
}

Map<String, Object?> _detailJson(List<Map<String, Object?>> segments) {
  return <String, Object?>{
    'sessionId': 'session_1',
    'mode': 'meeting',
    'status': 'ended',
    'consumedSeconds': 10,
    'createdAt': '2026-08-30T00:00:00.000Z',
    'segmentCount': segments.length,
    'segments': segments,
  };
}

Map<String, Object?> _segment(
  String id,
  String speakerId,
  int startMs,
  int endMs, {
  bool overlap = false,
}) {
  return <String, Object?>{
    'id': id,
    'sourceText': id,
    'translatedText': 'translated $id',
    'speaker': <String, Object?>{
      'speakerId': speakerId,
      'role': 'speaker',
      'source': 'diarization',
    },
    'timing': <String, Object?>{
      'startMs': startMs,
      'endMs': endMs,
      'source': 'model',
      if (overlap) 'overlap': true,
    },
  };
}
