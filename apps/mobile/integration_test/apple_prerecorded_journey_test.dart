import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:translation_mobile/src/features/realtime/presentation/controllers/realtime_controller.dart';
import 'package:translation_mobile/src/features/shell/presentation/pages/main_shell_page.dart';
import 'package:translation_mobile/src/platform/translation/translation_language_pair.dart';

import 'support/prerecorded_app_fixture.dart';
import 'support/prerecorded_test_scope.dart';
import 'support/prerecorded_language_trial.dart';

/// Explicit QA entry for the ORIGINAL TranslationApp, not another App or Scene.
/// Needs an authorized signed QA build + staged synthetic WAV + installed assets.
/// Production native builds reject this input before permission/capture calls.
void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const matrix = String.fromEnvironment('S2_LANGUAGE_TRIALS');
  final trials = matrix.isEmpty
      ? [
          PrerecordedLanguageTrial({
            'id': 'single',
            'name': const String.fromEnvironment('S2_INPUT_NAME'),
            'sha256': const String.fromEnvironment('S2_INPUT_SHA256'),
            'source': const String.fromEnvironment('S2_SOURCE_LANGUAGE'),
            'target': const String.fromEnvironment('S2_TARGET_LANGUAGE'),
            'kind': 'journey',
          })
        ]
      : PrerecordedLanguageTrial.parse(matrix);
  final reports = <Map<String, Object?>>[];
  var blocked = false;
  for (final trial in trials) {
    testWidgets('original app prerecorded ${trial.id}', (tester) async {
      if (blocked) {
        throw StateError(
            'NOT_RUN: previous trial failed; isolation is retained');
      }
      await _runTrial(tester, trial, (report) {
        reports.add(report);
        blocked = ![
          'DEVICE_PRERECORDED_JOURNEY_PASS',
          'DEVICE_ASR_OBSERVATION_COMPLETE'
        ].contains(report['status']);
        binding.reportData = {
          'schemaVersion': 2,
          'trials': reports,
          'plannedTrialCount': trials.length,
          'pendingTrialIds':
              trials.skip(reports.length).map((t) => t.id).toList(),
          'automaticLanguageQualified': false,
          'qualityQualified': false
        };
      });
    }, timeout: const Timeout(Duration(minutes: 4)));
  }
}

Future<void> _runTrial(WidgetTester tester, PrerecordedLanguageTrial trial,
    void Function(Map<String, Object?>) onReport) async {
  final name = trial.name,
      sha = trial.sha256,
      source = trial.source,
      target = trial.target;
  final report = <String, Object?>{
    'schemaVersion': 1,
    'test': 's2_prerecorded_original_ui',
    'status': 'NOT_COMPLETED',
    'trialId': trial.id,
    'observeOnly': trial.observeOnly,
    'inputName': name,
    'sha256': sha,
    'sourceLanguage': source,
    'targetLanguage': target,
    'modelDownloadsAllowed': false,
    'voiceOutput': 'off',
    'physicalAudioQualified': false,
    'modelQualityQualified': false,
  };
  PrerecordedTestScope? scope;
  PrerecordedAppFixture? fixture;
  var cleanupDrained = false;
  try {
    if (name.isEmpty ||
        !RegExp(r'^[a-f0-9]{64}$').hasMatch(sha) ||
        canonicalTranslationLanguageCode(source) == null ||
        canonicalTranslationLanguageCode(target) == null ||
        source == target) {
      throw StateError(
          'Explicit fixture name/SHA and fixed supported language pair are required');
    }
    // Read-only input is resolved BEFORE redirecting all Dart business paths.
    final input =
        await PrerecordedTestScope.readStagedInput(name: name, sha256: sha);
    scope = await PrerecordedTestScope.create();
    fixture = PrerecordedAppFixture(
        input: input,
        sourceLanguage: source,
        targetLanguage: target,
        observeOnly: trial.observeOnly);
    final current = fixture;
    report['resultDirectory'] = scope.root.path;
    await tester.pumpWidget(current.app);
    await _until(
        tester, () => find.byType(MainShellPage).evaluate().isNotEmpty);
    expect(find.byType(NavigationDestination), findsNWidgets(5));
    expect(find.text('停止验证'), findsNothing);
    expect(await current.store.listSessions(), isEmpty);
    await tester.tap(find.byKey(const ValueKey('realtime-primary-action')));
    await _until(
        tester, () => current.controller.status == RealtimeStatus.active,
        fixture: current);
    report['startThroughOriginalControls'] = true;
    await _until(tester, () => current.inputCompletions.isNotEmpty,
        fixture: current, timeout: const Duration(seconds: 90));
    expect(current.inputCompletions, hasLength(1));
    expect(current.inputCompletions.single['sha256'], sha);
    report['inputCompleted'] = current.inputCompletions.single;
    // Normal stop drains final ASR + MT before persisting the original history.
    await tester.tap(find.byKey(const ValueKey('realtime-secondary-action')));
    await _until(
        tester, () => current.controller.status == RealtimeStatus.ended,
        fixture: current);
    final segments = current.controller.segments;
    if (!trial.observeOnly) {
      expect(
          segments.any((s) =>
              s.sourceText.trim().isNotEmpty &&
              s.translatedText.trim().isNotEmpty),
          true);
      final first = segments.firstWhere((s) =>
          s.sourceText.trim().isNotEmpty && s.translatedText.trim().isNotEmpty);
      expect(find.textContaining(first.sourceText, findRichText: true),
          findsWidgets);
      expect(find.textContaining(first.translatedText, findRichText: true),
          findsWidgets);
    } else {
      expect(segments.every((s) => s.translatedText.isEmpty), true);
    }
    final native = await current.provider.runtimeDiagnostics();
    report['nativeAfterStop'] = native;
    report['inputObservations'] = current.inputObservations;
    report['observationOverflow'] = current.observationOverflow;
    expect(current.observationOverflow, false);
    expect(native['inputKind'], 'prerecorded');
    expect(native['sha256'], sha);
    expect(native['microphoneCreated'], false);
    expect(native['running'], false);
    expect(native['overflow'], false);
    final expected = native['expectedSamples'];
    expect(expected,
        isA<int>().having((n) => n, 'positive sample count', greaterThan(0)));
    for (final key in ['receivedSamples', 'acceptedSamples', 'fedSamples']) {
      expect(native[key], expected, reason: key);
    }
    await current.store.waitForWrites();
    final sessions = await current.store.listSessions();
    expect(sessions, hasLength(1));
    await current.controller.stop();
    expect(await current.store.listSessions(), hasLength(1));
    expect(current.store.writeCount, 1);
    final detail = await current.store.getSession(sessions.single.sessionId);
    expect(detail.status, 'ended');
    expect(detail.segments.length, segments.length);
    for (final segment in segments) {
      expect(
          detail.segments.any((s) =>
              s.sourceText == segment.sourceText &&
              s.translatedText == segment.translatedText),
          true);
    }
    report['localHistorySessionId'] = detail.sessionId;
    report['savedSegmentCount'] = detail.segments.length;
    report['historyWriteCount'] = current.store.writeCount;
    report['checkpointWriteCount'] = current.store.checkpointWriteCount;
    report['subtitles'] = detail.segments
        .map((s) => {
              'sourceText': s.sourceText,
              'translatedText': s.translatedText,
              if (s.rawText != null) 'rawText': s.rawText,
              if (s.optimizedText != null) 'optimizedText': s.optimizedText,
              if (s.refinement != null) 'refinement': s.refinement,
              'sourceLanguage': s.sourceLanguage,
              'targetLanguage': s.targetLanguage
            })
        .toList();
    await tester.tap(find.byType(NavigationDestination).at(3));
    final record = find.byType(ListTile);
    await _until(tester, () => record.evaluate().isNotEmpty);
    await tester.tap(record);
    await _until(tester, () => find.text('会话详情').evaluate().isNotEmpty);
    if (segments.isNotEmpty) {
      await _until(
          tester,
          () => find
              .textContaining(segments.first.sourceText, findRichText: true)
              .evaluate()
              .isNotEmpty);
    }
    report['historyOpenedThroughOriginalUI'] = true;
    expect(scope.blockedNetworkAttempts, 0);
    expect(current.capture.startCalls, 0);
    report['status'] = trial.observeOnly
        ? 'DEVICE_ASR_OBSERVATION_COMPLETE'
        : 'DEVICE_PRERECORDED_JOURNEY_PASS';
  } catch (error) {
    report['status'] = 'FAILED_OR_BLOCKED';
    report['error'] = error.toString();
    rethrow;
  } finally {
    report['asrAvailability'] = fixture?.asrAvailabilityReports ?? [];
    // Keep isolation active until every asynchronous controller cleanup ends.
    try {
      await fixture?.stop();
      await tester.pumpWidget(const SizedBox.shrink());
      await fixture?.drainAndClose();
      cleanupDrained = true;
      report['inputObservations'] = fixture?.inputObservations ?? [];
      report['observationOverflow'] = fixture?.observationOverflow ?? false;
      if (scope != null) {
        report['blockedBusinessNetworkAttempts'] = scope.blockedNetworkAttempts;
        expect(scope.blockedNetworkAttempts, 0);
        await scope.writeReport(
            'journey.json', const JsonEncoder.withIndent('  ').convert(report));
      }
    } catch (cleanupError) {
      report['status'] = 'CLEANUP_FAILED';
      report['cleanupError'] = cleanupError.toString();
      rethrow;
    } finally {
      // Any failed startup may still have a pending OS permission callback.
      // Keep isolation for the rest of that QA process, even if stop returned.
      try {
        if (cleanupDrained &&
            [
              'DEVICE_PRERECORDED_JOURNEY_PASS',
              'DEVICE_ASR_OBSERVATION_COMPLETE'
            ].contains(report['status'])) {
          scope?.close();
        }
      } catch (error) {
        report['status'] = 'CLEANUP_FAILED';
        report['cleanupError'] = error.toString();
        try {
          await scope?.writeReport('journey.json', jsonEncode(report));
        } catch (_) {}
        rethrow;
      } finally {
        onReport(report);
      }
    }
  }
}

Future<void> _until(WidgetTester tester, bool Function() ready,
    {PrerecordedAppFixture? fixture,
    Duration timeout = const Duration(seconds: 30)}) async {
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    await tester.pump(const Duration(milliseconds: 100));
    if (ready()) return;
    if (fixture != null && fixture.controller.status == RealtimeStatus.failed) {
      throw StateError(
          'Original controller failed: ${fixture.controller.message}');
    }
  }
  throw StateError(
      'Original UI deadline exceeded: ${fixture?.controller.message ?? "UI state"}');
}
