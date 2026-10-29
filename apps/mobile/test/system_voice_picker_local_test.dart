import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/realtime/presentation/widgets/system_voice_picker.dart';
import 'package:translation_mobile/src/features/realtime/presentation/pages/language_capability_page.dart';
import 'package:translation_mobile/src/platform/speech/speech_output_provider.dart';
import 'package:translation_mobile/src/platform/speech/system_voice_preferences.dart';

void main() {
  testWidgets('user selects a local voice, persisted ID reaches the speech bridge', (tester) async {
    final dir=Directory.systemTemp.createTempSync('voice-picker-');
    addTearDown(() => dir.deleteSync(recursive:true));
    const channel=MethodChannel('fixture/voice-picker');
    final messenger=TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    final calls=<MethodCall>[];
    messenger.setMockMethodCallHandler(channel,(call) async {
      calls.add(call);
      if(call.method=='voices') {
        final zh=(call.arguments as Map)['language']=='zh';
        return [{'identifier':zh?'com.apple.voice.zh1':'com.apple.voice.en1',
          'name':zh?'中文声音 A':'English voice A','language':zh?'zh-CN':'en-US','quality':2}];
      }
      return {'provider':'fixture','language':'zh'};
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel,null));
    final prefs=SystemVoicePreferences(directory:() async => dir);
    final provider=SystemSpeechOutputProvider(channel:channel,preferences:prefs,useVoicePreferences:true);
    await tester.pumpWidget(MaterialApp(locale:const Locale('zh'),
      localizationsDelegates:const [AppLocalizations.delegate,GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,GlobalCupertinoLocalizations.delegate],
      supportedLocales:AppLocalizations.supportedLocales,
      home:Scaffold(body:SystemVoicePicker(enabled:true,provider:provider,preferences:prefs))));
    await tester.pumpAndSettle();
    for (var i=0; i<20 && find.text('中文：系统默认').evaluate().isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
      await tester.pump();
    }
    await tester.tap(find.text('中文：系统默认'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('中文声音 A'));
    await tester.pumpAndSettle();
    for (var i=0; i<20 && find.text('中文：中文声音 A (zh-CN)').evaluate().isEmpty; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
      await tester.pump();
    }
    expect(await tester.runAsync(() => prefs.selected('zh')),'com.apple.voice.zh1');
    expect(await tester.runAsync(() => prefs.selected('en')),isNull);
    expect(find.text('中文：中文声音 A (zh-CN)'),findsOneWidget);
    await tester.runAsync(() => provider.speak(text:'测试',language:'zh'));
    expect((calls.last.arguments as Map)['voiceIdentifier'],'com.apple.voice.zh1');
  });

  testWidgets('expanding a language reads local status without a setState future', (tester) async {
    final messenger=TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    for (final name in ['translation_mobile/ocr','translation_mobile/apple_speech_asr',
      'translation_mobile/on_device_translation','translation_mobile/speech_output']) {
      final channel=MethodChannel(name);
      messenger.setMockMethodCallHandler(channel,(call) async {
        if(call.method=='supportedLanguages') return ['zh-Hans'];
        if(call.method=='voices') return [];
        if(name.endsWith('apple_speech_asr')) return {'locale':'zh-CN','resourcesInstalled':true};
        return {'available':true,'status':'installed'};
      });
      addTearDown(() => messenger.setMockMethodCallHandler(channel,null));
    }
    await tester.pumpWidget(const MaterialApp(locale:Locale('zh'),
      localizationsDelegates:const [AppLocalizations.delegate,GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,GlobalCupertinoLocalizations.delegate],
      supportedLocales:AppLocalizations.supportedLocales,home:const LanguageCapabilityPage()));
    await tester.tap(find.byType(ExpansionTile).first);
    await tester.pumpAndSettle();
    expect(find.textContaining('文字识别：'),findsOneWidget);
    expect(find.textContaining('语音识别：'),findsOneWidget);
    expect(tester.takeException(),isNull);
  });
}
