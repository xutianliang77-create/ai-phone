import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/app_build_identity.dart';

void main() {
  test('accepts only a clean candidate with full commit and tree hashes', () {
    const identity = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
      productProfile: 'core_translation',
    );

    expect(identity.isTraceable, isTrue);
    expect(identity.toJson(), <String, Object?>{
      'candidateId': 'wujie-ios-v1',
      'sourceCommit': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sourceTree': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'sourceState': 'clean',
      'productProfile': 'core_translation',
      'traceable': true,
    });
  });

  test('rejects dirty, abbreviated or unnamed source identities', () {
    const dirty = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'dirty',
      productProfile: 'core_translation',
    );
    const abbreviated = AppBuildIdentity(
      candidateId: 'wujie-ios-v1',
      sourceCommit: 'abcdef0',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
      productProfile: 'core_translation',
    );
    const unnamed = AppBuildIdentity(
      candidateId: 'untraceable',
      sourceCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sourceTree: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      sourceState: 'clean',
      productProfile: 'core_translation',
    );

    expect(dirty.isTraceable, isFalse);
    expect(abbreviated.isTraceable, isFalse);
    expect(unnamed.isTraceable, isFalse);
  });
}
