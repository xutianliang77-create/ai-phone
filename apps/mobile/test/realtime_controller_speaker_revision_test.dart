import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';

GatewayRealtimeEvent event(String type, String speaker, {int revision=1, int? speakerRevision}) => GatewayRealtimeEvent.fromJson({
  'type':type,'sessionId':'sess_1','segmentId':'segment','revision':revision,
  if(speakerRevision!=null)'speakerRevision':speakerRevision,
  if(type!='speaker.updated')'text':type=='translation.final'?'译文保持不变':'Source stays unchanged.',
  'language':'en','speaker':{'speakerId':speaker,'role':speaker=='unknown'?'unknown':'speaker',
    'source':speaker=='unknown'?'unknown':'diarization'},'timing':{'startMs':0,'endMs':1000,'source':'model'}});
void main(){
  test('later MT cannot undo a confirmed speaker metadata revision',() async {
    final r=FakeRealtimeRepository();
    final controller=realtimeControllerForTest(r,FakeAudioCapture());addTearDown(controller.dispose);await controller.start();
    r.emit(event('transcript.final','unknown'));r.emit(event('speaker.updated','device-speaker-2',speakerRevision:1));
    r.emit(event('translation.final','unknown'));await pumpEventQueue();
    expect(controller.segments.single.speaker?.speakerId,'device-speaker-2');
    expect(controller.segments.single.translatedText,'译文保持不变');
  });
  test('stale speaker revisions are ignored but a new ASR revision can replace timing and attribution',() async {
    final r=FakeRealtimeRepository();
    final c=realtimeControllerForTest(r,FakeAudioCapture());addTearDown(c.dispose);await c.start();
    r.emit(event('transcript.final','unknown'));r.emit(event('speaker.updated','device-speaker-2',speakerRevision:2));
    r.emit(event('speaker.updated','device-speaker-1',speakerRevision:1));await pumpEventQueue();
    expect(c.segments.single.speaker?.speakerId,'device-speaker-2');
    r.emit(event('transcript.final','device-speaker-3',revision:2));await pumpEventQueue();
    expect(c.segments.single.speaker?.speakerId,'device-speaker-3');
  });
}
