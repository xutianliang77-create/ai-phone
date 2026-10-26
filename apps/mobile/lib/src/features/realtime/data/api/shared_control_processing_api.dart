import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import '../../../account/data/account_session_store.dart';
import '../../../account/data/account_scoped_http.dart';
import '../../../../platform/http/public_http_client.dart';
import '../../../../platform/http/account_bound_http_client.dart';
import 'realtime_api_client.dart';
import 'realtime_session.dart';
import 'shared_control_proof_client.dart';
import 'shared_control_request_journal.dart';

/// Shared identity and ledger only; original processing options and providers.
class SharedControlProcessingApiClient extends RealtimeApiClient {
  factory SharedControlProcessingApiClient({
    required Uri processingBase,
    required Uri controlBase,
    required AccountSessionStore store,
    http.Client? processingClient,
    http.Client? controlClient,
    required String mode,
    required String source,
    required String target,
    required bool autoReverse,
    required String voiceMode,
    required String voicePreset,
    required String lexicon,
    SharedControlRequestJournal? journal,
    SharedControlProofClient Function(String owner)? proofFactory,
  }) {
    final transport = AccountBoundHttpClient(
      processingBase,
      store,
      inner: processingClient,
    );
    return SharedControlProcessingApiClient._(
      processingBase,
      controlBase,
      store,
      transport,
      controlClient ?? createPublicHttpClient(controlBase),
      journal ?? FileSharedControlRequestJournal(),
      proofFactory ?? ((owner) => SharedControlProofClient(ownerId: owner)),
      mode,
      source,
      target,
      autoReverse,
      voiceMode,
      voicePreset,
      lexicon,
    );
  }
  SharedControlProcessingApiClient._(
    this.processingBase,
    this.controlBase,
    this.store,
    this.processing,
    this.controlClient,
    this.journal,
    this.proofFactory,
    String mode,
    String source,
    String target,
    bool autoReverse,
    String voiceMode,
    String voicePreset,
    String lexicon,
  ) : super(
        baseUrl: processingBase,
        client: processing,
        accountSessionStore: store,
        mode: mode,
        sourceLanguage: source,
        targetLanguage: target,
        autoReverseTargetLanguage: autoReverse,
        voiceOutputMode: voiceMode,
        voicePresetId: voicePreset,
        domainLexiconPack: lexicon,
      );
  final Uri processingBase, controlBase;
  final AccountSessionStore store;
  final http.Client controlClient, processing;
  final SharedControlRequestJournal journal;
  final SharedControlProofClient Function(String owner) proofFactory;
  Future<RealtimeSession>? _cfCreating;
  String? _scope;
  Future<Map<String, Object?>> control(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    final r = await scopedAccountRequest(
      controlClient,
      store,
      controlBase,
      method,
      controlBase.resolve('/v10/control/$path'),
      authenticated: authenticated,
      body: body == null ? null : jsonEncode(body),
    );
    if (r.statusCode != 200) {
      throw RealtimeApiException(
        r.statusCode == 401 ? '请先登录账号' : '1.0授权服务尚未就绪，请稍后重试',
        statusCode: r.statusCode,
      );
    }
    return jsonDecode(r.body) as Map<String, Object?>;
  }

  @override
  Future<RealtimeSession> createSession() async {
    if (_cfCreating != null) return _cfCreating!;
    final running = _create();
    _cfCreating = running;
    try {
      return await running;
    } finally {
      if (identical(_cfCreating, running)) _cfCreating = null;
    }
  }

  Future<RealtimeSession> _create() async {
    if (processingBase.scheme != 'https' || processingBase.host.isEmpty) {
      throw const RealtimeApiException('1.0处理服务尚未配置');
    }
    final operation = await ScopedAccountOperation.capture(store),
        account = operation.original;
    final policy = await control('GET', 'configuration');
    await operation.check();
    if (policy['execution'] != 'retained_v10_processing' ||
        normalizedProcessingBase(
              policy['processingApiBaseUrl'] as String? ?? '',
            ) !=
            normalizedProcessingBase(processingBase.toString())) {
      throw const RealtimeApiException('1.0处理服务配置尚未确认');
    }
    final options = await buildCreateRequestBody(),
        scope = jsonEncode([
          account.deploymentId,
          account.ownerId,
          processingBase.toString(),
        ]);
    _scope = scope;
    var pending = await journal.load(scope);
    if (pending != null) {
      final resolution = await control(
        'POST',
        'requests/resolve',
        body: {'requestKey': pending['requestKey']},
      );
      await operation.check();
      if (['ended', 'cancelled'].contains(resolution['status'])) {
        await journal.clear(scope);
        throw const RealtimeApiException('上一会话已结束，请再次开始');
      }
      final originalEnvelope =
          jsonDecode(
                utf8.decode(
                  base64Decode(
                    (pending['envelope'] as Map)['clientData'] as String,
                  ),
                ),
              )
              as Map;
      if (originalEnvelope['planHash'] != policy['planHash'] ||
          (resolution['status'] == 'prepared' &&
              resolution['admissionExpiresAtMs'] is int &&
              (resolution['admissionExpiresAtMs'] as int) <=
                  DateTime.now().millisecondsSinceEpoch) ||
          pending['optionsJson'] != jsonEncode(options) ||
          resolution['status'] == 'absent' &&
              DateTime.now().millisecondsSinceEpoch -
                      (pending['issuedAtMs'] as int) >
                  30000) {
        final cancelled = await control(
          'POST',
          'requests/cancel',
          body: {'requestKey': pending['requestKey']},
        );
        if (!['ended', 'cancelled'].contains(cancelled['status'])) {
          throw const RealtimeApiException('上一会话停止确认中，请稍后重试');
        }
        await journal.clear(scope);
        throw const RealtimeApiException('旧启动请求已安全取消，请再次开始');
      }
    } else {
      final proof = proofFactory(account.ownerId!),
          identity = await proof.identity();
      await operation.check();
      final challenge = await control(
        'POST',
        'devices/challenge',
        body: {'devicePublicKey': identity['devicePublicKey']},
      );
      final registration = await proof.register(challenge);
      await operation.check();
      await control('POST', 'devices/register', body: registration);
      await operation.check();
      final key = sha256
              .convert(
                List<int>.generate(32, (_) => Random.secure().nextInt(256)),
              )
              .toString(),
          at = DateTime.now().millisecondsSinceEpoch;
      final envelope = await proof.signIssue({
        'domain': 'wujie.v10-control.issue.v1',
        'requestKey': key,
        'deploymentId': account.deploymentId,
        'ownerId': account.ownerId,
        'devicePublicKey': identity['devicePublicKey'],
        'planHash': policy['planHash'],
        'mode': options['mode'],
        'sourceLanguage': options['sourceLanguage'],
        'targetLanguage': options['targetLanguage'],
        'voiceOutput': options['voiceOutput'],
        'options': options,
        'issuedAtMs': at,
      });
      await operation.check();
      pending = {
        'requestKey': key,
        'envelope': envelope,
        'issuedAtMs': at,
        'optionsJson': jsonEncode(options),
      };
      await journal.save(scope, pending);
    }
    await operation.check();
    final request =
        http.Request('POST', processingBase.resolve('/realtime/sessions'))
          ..followRedirects = false
          ..headers.addAll({
            'content-type': 'application/json',
            'authorization': 'Bearer ${account.token}',
          })
          ..body = jsonEncode({
            ...options,
            'controlEnvelope': pending['envelope'],
          });
    final response = await http.Response.fromStream(
      await processing.send(request),
    );
    await operation.check();
    if (response.statusCode != 200) {
      throw RealtimeApiException(
        '1.0授权尚未完成，请稍后重试',
        statusCode: response.statusCode,
      );
    }
    final value = jsonDecode(response.body) as Map<String, Object?>,
        binding = value['controlBinding'];
    if (binding is! Map ||
        binding['ownerId'] != account.ownerId ||
        binding['deploymentId'] != account.deploymentId ||
        binding['execution'] != 'retained_v10_processing') {
      throw const RealtimeApiException('会话身份不匹配');
    }
    final session = RealtimeSession.fromJson(value);
    if (session.endpoint.scheme != 'wss' ||
        session.endpoint.host != processingBase.host ||
        session.endpoint.userInfo.isNotEmpty ||
        session.endpoint.hasQuery ||
        session.endpoint.hasFragment ||
        !session.expiresAt.isAfter(DateTime.now())) {
      throw const RealtimeApiException('control_ticket_endpoint_or_expiry');
    }
    return session;
  }

  @override
  Future<void> finalizeWithGatewayReceipt({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
    required String gatewayReceipt,
  }) async {
    await control(
      'POST',
      'finish',
      body: {'gatewayReceipt': gatewayReceipt},
      authenticated: false,
    );
    await super.finalizeWithGatewayReceipt(
      sessionId: sessionId,
      segments: segments,
      billableSeconds: billableSeconds,
      idempotencyKey: idempotencyKey,
      gatewayReceipt: gatewayReceipt,
    );
    if (_scope != null) await journal.clear(_scope!);
  }

  @override
  Future<void> endSession(String sessionId) async {
    await super.endSession(sessionId);
    if (_scope != null) await journal.clear(_scope!);
  }

  @override
  Future<void> finalizeSession({
    required String sessionId,
    required List<Map<String, Object?>> segments,
    required int billableSeconds,
    required String idempotencyKey,
  }) => endSession(sessionId);
  @override
  void close() {
    controlClient.close();
    super.close();
  }
}

String normalizedProcessingBase(String value) =>
    value.replaceFirst(RegExp(r'/+$'), '');
