import 'dart:typed_data';

/// Test-only input data. Native code verifies the WAV format and SHA before use;
/// normal app builds reject it unless explicitly compiled with the test flag.
class AppleSpeechPrerecordedInput {
  AppleSpeechPrerecordedInput(
      {required Uint8List wavBytes, required this.sha256})
      : _wavBytes = Uint8List.fromList(wavBytes) {
    if (_wavBytes.length < 44 ||
        _wavBytes.length > 2000000 ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(sha256)) {
      throw ArgumentError('Invalid bounded prerecorded input');
    }
  }

  final Uint8List _wavBytes;
  final String sha256;

  Map<String, Object?> toChannelArguments() => {
        'inputKind': 'prerecorded',
        'prerecordedInput': {
          'wav': Uint8List.fromList(_wavBytes),
          'sha256': sha256
        },
      };
}
