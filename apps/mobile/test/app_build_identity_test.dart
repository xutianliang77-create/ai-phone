import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_build_identity.dart';

void main() {
  test('accepts only a clean candidate with full commit and tree hashes', () {
    const identity = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
    );

    expect(identity.isTraceable, isTrue);
    expect(identity.toJson(), <String, Object?>{
      'candidateId': 'wujie-ios-v1',
      'sourceCommit': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sourceTree': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'sourceState': 'clean',
      'traceable': true,
    });
  });

  test('rejects dirty, abbreviated or unnamed source identities', () {
    const dirty = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'dirty',
    );
    const abbreviated = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'abcdef0',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
    );
    const unnamed = AppBuildIdentity(
      candidateId: 'untraceable',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
    );

    expect(dirty.isTraceable, isFalse);
    expect(abbreviated.isTraceable, isFalse);
    expect(unnamed.isTraceable, isFalse);
  });
}
