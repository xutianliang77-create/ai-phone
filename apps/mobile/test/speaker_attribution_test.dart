import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/shared/domain/speaker_attribution.dart';

void main() {
  test('keeps call role objective outside a local participant view', () {
    const host = SpeakerAttribution(
      speakerId: 'host-user',
      role: 'host',
      source: 'participant_track',
    );
    const guest = SpeakerAttribution(
      speakerId: 'guest-user',
      role: 'guest',
      source: 'participant_track',
    );

    expect(host.label(isChinese: true), '主持人');
    expect(guest.label(isChinese: true), '访客');
  });

  test('renders call roles from the current participant perspective', () {
    const host = SpeakerAttribution(
      speakerId: 'host-user',
      role: 'host',
      source: 'participant_track',
    );
    const guest = SpeakerAttribution(
      speakerId: 'guest-user',
      role: 'guest',
      source: 'participant_track',
    );

    expect(host.label(isChinese: true, localRole: 'host'), '我');
    expect(guest.label(isChinese: true, localRole: 'host'), '对方');
    expect(host.label(isChinese: true, localRole: 'guest'), '对方');
    expect(guest.label(isChinese: true, localRole: 'guest'), '我');
  });
}
