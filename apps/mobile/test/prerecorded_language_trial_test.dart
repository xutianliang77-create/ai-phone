import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import '../integration_test/support/prerecorded_language_trial.dart';

void main() {
  final row = {
    'id': 'zh_example',
    'name': 'zh_short_002',
    'sha256': 'a' * 64,
    'source': 'zh',
    'target': 'en',
    'kind': 'asr_observation'
  };
  test(
      'matrix has explicit fixed parameters and does not expose reference text to a provider',
      () {
    final trials = PrerecordedLanguageTrial.parse(jsonEncode([
      row,
      {
        ...row,
        'id': 'en_example',
        'source': 'en',
        'target': 'zh',
        'kind': 'journey'
      }
    ]));
    expect(trials.first.observeOnly, true);
    expect(trials.last.observeOnly, false);
    expect(trials.first.source, 'zh');
    expect(trials.last.source, 'en');
  });
  test(
      'rejects arbitrary paths, missing directions, references, unknown mode and bad hashes',
      () {
    for (final invalid in [
      {...row, 'name': '../input'},
      {...row, 'source': 'auto'},
      {...row, 'sha256': 'invalid'},
      {...row, 'kind': 'cloud'},
      {...row, 'reference': 'ground truth'},
      {...row, 'target': 'zh'}
    ]) {
      expect(() => PrerecordedLanguageTrial.parse(jsonEncode([invalid])),
          throwsFormatException);
    }
  });
  test('matrix is bounded and trial identity is unique', () {
    for (final value in [
      [],
      [row, row],
      List.filled(25, row)
    ]) {
      expect(() => PrerecordedLanguageTrial.parse(jsonEncode(value)),
          throwsFormatException);
    }
  });
}
