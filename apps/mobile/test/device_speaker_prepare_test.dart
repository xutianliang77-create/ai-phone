import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/audio/device_speaker_diarizer.dart';
void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  test('slow CoreML preparation does not block cloud creation and is reused on next start',() async {
    const channel=MethodChannel('test-device-speaker');final loaded=Completer<Map<String,Object?>>();int calls=0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,(call) async {
      if(call.method=='recordPreparationDecision')return null;
      expect(call.method,'prepare');calls++;return loaded.future;
    });
    addTearDown(()=>TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,null));
    final model=NativeDeviceSpeakerDiarizer(channel:channel,stream:const Stream.empty(),readinessWait:const Duration(milliseconds:10));
    expect(await model.prepare(),isFalse);expect(calls,1);
    expect(model.readiness,DeviceSpeakerReadiness.waitTimedOut);
    loaded.complete({'ready':true,'profile':deviceSpeakerProfile,'modelRevision':deviceSpeakerRevision,'maxSpeakers':4});
    expect(await model.prepare(),isTrue);expect(calls,1);
    expect(model.readiness,DeviceSpeakerReadiness.ready);
  });
  for(final code in ['device_speaker_model_missing','device_speaker_model_invalid','device_speaker_busy']){
    test('retains native readiness reason $code and allows a later retry',() async {
      const channel=MethodChannel('test-speaker-reasons');var calls=0;
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,(call) async {
        if(call.method!='prepare')return null;
        calls++;
        if(calls==1)throw PlatformException(code:code);
        return {'ready':true,'profile':deviceSpeakerProfile,'modelRevision':deviceSpeakerRevision,'maxSpeakers':4};
      });
      addTearDown(()=>TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,null));
      final model=NativeDeviceSpeakerDiarizer(channel:channel,stream:const Stream.empty());
      expect(await model.prepare(),isFalse);
      expect(model.readiness,{'device_speaker_model_missing':DeviceSpeakerReadiness.modelMissing,
        'device_speaker_model_invalid':DeviceSpeakerReadiness.modelInvalid,'device_speaker_busy':DeviceSpeakerReadiness.busy}[code]);
      expect(await model.prepare(),isTrue);expect(calls,2);
    });
  }
  test('a loaded wrong model cannot be called ready',() async {
    const channel=MethodChannel('test-speaker-wrong-profile');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,(call) async =>
      {'ready':true,'profile':deviceSpeakerProfile,'modelRevision':'wrong','maxSpeakers':4});
    addTearDown(()=>TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,null));
    final model=NativeDeviceSpeakerDiarizer(channel:channel,stream:const Stream.empty());
    expect(await model.prepare(),isFalse);expect(model.readiness,DeviceSpeakerReadiness.profileMismatch);
  });
}
