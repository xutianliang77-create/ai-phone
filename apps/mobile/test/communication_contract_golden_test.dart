import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'support/communication_contract_codec.dart';

void main() {
  test('Flutter decodes and re-encodes communication v1 golden fixtures', () {
    final command = fixture('command.json');
    final event = fixture('event.json');

    final decodedCommand = CommunicationContractEnvelope.fromJson(command);
    final decodedEvent = CommunicationContractEnvelope.fromJson(event);

    expect(decodedCommand.toJson(), command);
    expect(decodedEvent.toJson(), event);
    expect(decodedEvent.json['playbackId'], 'playback_001');
  });

  test('Flutter accepts additive fields and rejects breaking versions', () {
    final event = fixture('event.json')..['additiveField'] = 'v1-compatible';
    expect(CommunicationContractEnvelope.fromJson(event).json['additiveField'],
        'v1-compatible');

    event['contractVersion'] = 2;
    expect(
      () => CommunicationContractEnvelope.fromJson(event),
      throwsFormatException,
    );
  });
}

Map<String, Object?> fixture(String name) {
  final file = File('../../packages/contracts/fixtures/communication-v1/$name');
  return (jsonDecode(file.readAsStringSync()) as Map).cast<String, Object?>();
}
