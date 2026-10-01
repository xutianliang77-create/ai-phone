import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/gateway/gateway_realtime_event.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'helpers/realtime_controller_test_helpers.dart';

const notice='本句文本语种无法可靠确认，原文已保留，未发送翻译请求；会话继续。';
void main(){
  late FakeRealtimeRepository repository;
  late RealtimeController controller;
  setUp(() async {repository=FakeRealtimeRepository();controller=realtimeControllerForTest(repository,FakeAudioCapture());await controller.start();});
  tearDown(()=>controller.dispose());
  void emit(String type,String id,{String? text,int revision=1,String? message,String session='sess_1',String stage='translation'}){
    repository.emit(GatewayRealtimeEvent(type:type,sessionId:session,segmentId:id,revision:revision,text:text,
      language:type=='transcript.final'?'zh':'en',message:message,stage:stage));
  }
  Future<void> failed({int revision=1}) async {
    emit('transcript.final','short',text:'说。',revision:revision);
    emit('translation.failed','short',message:notice,revision:revision);await pumpEventQueue();
    expect(controller.message,notice);expect(controller.gatewayDiagnostic,isNotNull);
  }
  test('a following normal translation clears the previous notice without deleting its original text',() async {
    await failed();emit('transcript.final','next',text:'嗯哼。');emit('translation.final','next',text:'Uh-huh.');await pumpEventQueue();
    expect(controller.message,isNull);expect(controller.gatewayDiagnostic,isNull);expect(controller.status.name,'active');
    expect(controller.segments.first.sourceText,'说。');expect(controller.segments.first.translatedText,isEmpty);
    expect(controller.segments.last.translatedText,'Uh-huh.');
  });
  test('an older revision cannot clear the notice or replace its current source',() async {
    await failed(revision:2);emit('translation.final','short',text:'Old result',revision:1);await pumpEventQueue();
    expect(controller.message,notice);expect(controller.gatewayDiagnostic,isNotNull);expect(controller.segments.single.translatedText,isEmpty);
    emit('translation.final','short',text:'Speak.',revision:2);await pumpEventQueue();
    expect(controller.message,isNull);expect(controller.gatewayDiagnostic,isNull);
  });
  test('a delayed earlier segment does not dismiss a newer segment notice',() async {
    emit('transcript.final','earlier',text:'之前的句子。');await pumpEventQueue();await failed();
    emit('translation.final','earlier',text:'Earlier sentence.');await pumpEventQueue();
    expect(controller.message,notice);expect(controller.gatewayDiagnostic,isNotNull);
  });
  test('successful translation must not clear a newer unrelated playback failure',() async {
    await failed();emit('error','short',message:'播放失败，请检查声音路由',stage:'tts');await pumpEventQueue();
    final playbackMessage=controller.message;expect(playbackMessage,contains('播放失败'));
    emit('transcript.final','next',text:'新的句子。');emit('translation.final','next',text:'A new sentence.');await pumpEventQueue();
    expect(controller.message,playbackMessage);expect(controller.status.name,'active');
  });
  test('model timing takes precedence over delayed source arrival when clearing a notice',() async {
    for(final entry in [('short',30000),('earlier',1000)]){
      repository.emit(GatewayRealtimeEvent.fromJson({'type':'transcript.final','sessionId':'sess_1',
        'segmentId':entry.$1,'revision':1,'text':'中文。','language':'zh',
        'timing':{'startMs':entry.$2,'endMs':entry.$2+600,'source':'model'}}));
    }
    emit('translation.failed','short',message:notice);await pumpEventQueue();
    emit('translation.final','earlier',text:'Earlier result.');await pumpEventQueue();
    expect(controller.message,notice);expect(controller.gatewayDiagnostic,isNotNull);
  });
  test('foreign-session and empty successes cannot dismiss the notice',() async {
    await failed();emit('translation.final','short',text:'Foreign',session:'other');emit('translation.final','short',text:'。');await pumpEventQueue();
    expect(controller.message,notice);expect(controller.gatewayDiagnostic,isNotNull);
  });
}
