import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:translation_mobile/src/app/localization/app_localizations.dart';
import 'package:translation_mobile/src/features/account/data/account_auth_headers.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/data/ai_calling_agent_api_client.dart';
import 'package:translation_mobile/src/features/ai_calling_agent/presentation/pages/ai_calling_agent_page.dart';
import 'package:translation_mobile/src/features/compliance/data/voice_processing_consent_store.dart';

Future<void> pumpAgentPage(
  WidgetTester tester, {
  required FakeAiCallingAgentClient client,
  required VoiceProcessingConsentStore voiceConsentStore,
  double textScale = 1,
}) async {
  await tester.pumpWidget(MaterialApp(
    locale: const Locale('zh'),
    localizationsDelegates: const <LocalizationsDelegate<dynamic>>[
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
      ),
      child: child!,
    ),
    home: AiCallingAgentPage(
      client: client,
      voiceConsentStore: voiceConsentStore,
    ),
  ));
}

class FakeAiCallingAgentClient extends AiCallingAgentApiClient {
  FakeAiCallingAgentClient({
    this.authRequired = false,
    this.initialDrafts = const <AiCallingAgentDraft>[],
    this.listError,
  }) : super(
          baseUrl: Uri.parse('http://localhost'),
          client: MockClient((_) async => http.Response('{}', 500)),
        );

  final bool authRequired;
  final List<AiCallingAgentDraft> initialDrafts;
  final Object? listError;
  final List<String> authorizedDraftIds = <String>[];
  final List<String> startedDraftIds = <String>[];
  final List<String> refreshedDraftIds = <String>[];
  final List<String> takeoverDraftIds = <String>[];
  final List<String> cancelledDraftIds = <String>[];

  @override
  Future<List<AiCallingAgentDraft>> listDrafts() async {
    if (listError != null) throw listError!;
    return initialDrafts;
  }

  @override
  Future<AiCallingAgentDraft> createDraft({
    required String scenario,
    required String objective,
    String language = 'zh',
    String? targetName,
    String? targetPhone,
    String? suggestedScript,
  }) async {
    if (authRequired) throw const AccountAuthRequiredException();
    final highRisk = objective.contains('转账') || objective.contains('身份验证');
    return agentDraft(
      objective: objective,
      status: highRisk ? 'requires_human_takeover' : 'draft',
      riskLevel: highRisk ? 'requires_human_takeover' : 'low',
      riskReasons: highRisk
          ? const <String>['payment', 'identity_verification']
          : const <String>[],
    );
  }

  @override
  Future<AiCallingAgentDraft> authorizeDraft({
    required String draftId,
    required String consentPromptVersion,
    required bool recipientDisclosureConfirmed,
    required String disclosurePromptVersion,
  }) async {
    authorizedDraftIds.add(draftId);
    return agentDraft(status: 'authorized');
  }

  @override
  Future<AiCallingAgentDraft> startDraft({
    required String draftId,
    required String consentPromptVersion,
  }) async {
    startedDraftIds.add(draftId);
    return agentDraft(status: 'queued', callId: 'call_1');
  }

  @override
  Future<AiCallingAgentDraft> getDraft({required String draftId}) async {
    refreshedDraftIds.add(draftId);
    return agentDraft(
      status: 'completed',
      callId: 'call_1',
      resultSummary: '已完成预约。',
    );
  }

  @override
  Future<AiCallingAgentDraft> requestTakeover({
    required String draftId,
    required String reason,
  }) async {
    takeoverDraftIds.add(draftId);
    return agentDraft(
      status: 'takeover_requested',
      riskLevel: 'requires_human_takeover',
      riskReasons: const <String>['payment', 'identity_verification'],
    );
  }

  @override
  Future<AiCallingAgentDraft> cancelDraft({
    required String draftId,
    String reason = 'user_cancelled',
  }) async {
    cancelledDraftIds.add(draftId);
    return agentDraft(status: 'cancelled');
  }
}

AiCallingAgentDraft agentDraft({
  String objective = '预约牙医复诊',
  String status = 'draft',
  String riskLevel = 'low',
  List<String> riskReasons = const <String>[],
  String? callId,
  String? resultSummary,
  String? executionProvider,
  String? carrierState,
  String? liveKitParticipantState,
}) {
  return AiCallingAgentDraft(
    id: 'draft_1',
    scenario: 'booking',
    status: status,
    objective: objective,
    suggestedScript: '您好，我想咨询：$objective',
    language: 'zh',
    riskLevel: riskLevel,
    riskReasons: riskReasons,
    callId: callId,
    resultSummary: resultSummary,
    executionProvider: executionProvider,
    carrierState: carrierState,
    liveKitParticipantState: liveKitParticipantState,
  );
}
