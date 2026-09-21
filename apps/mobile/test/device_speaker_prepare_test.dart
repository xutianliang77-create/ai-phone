import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/platform/audio/device_speaker_diarizer.dart';
void main(){
  TestWidgetsFlutterBinding.ensureInitialized();
  test('slow CoreML preparation does not block cloud creation and is reused on next start',() async {
    const channel=MethodChannel('test-device-speaker');final loaded=Completer<Map<String,Object?>>();int calls=0;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,(call) async {
      expect(call.method,'prepare');calls++;return loaded.future;
    });
    addTearDown(()=>TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel,null));
    final model=NativeDeviceSpeakerDiarizer(channel:channel,stream:const Stream.empty(),readinessWait:const Duration(milliseconds:10));
    expect(await model.prepare(),isFalse);expect(calls,1);
    loaded.complete({'ready':true,'profile':deviceSpeakerProfile,'modelRevision':deviceSpeakerRevision,'maxSpeakers':4});
    expect(await model.prepare(),isTrue);expect(calls,1);
  });
}
