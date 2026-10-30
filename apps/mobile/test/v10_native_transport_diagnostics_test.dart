import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:cupertino_http/cupertino_http.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:translation_mobile/src/platform/http/foundation_http_client.dart';
import 'package:translation_mobile/src/platform/http/observed_http_request.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'real loopback URLSession emits task phases and transaction metrics',
    () async {
      expect(const bool.fromEnvironment('WUJIE_CONTROL_DIAGNOSTICS'), isTrue);
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        if (request.uri.path == '/redirect') {
          request.response.statusCode = 302;
          request.response.headers.set('location', '/ok');
        } else {
          request.response.headers.contentType = ContentType.json;
          request.response.write('{}');
        }
        await request.response.close();
      });
      final config = URLSessionConfiguration.ephemeralSessionConfiguration()
        ..cache = null
        ..httpShouldSetCookies = false
        ..waitsForConnectivity = false;
      final client = FoundationHttpClient(config);
      addTearDown(() async {
        client.close();
        await server.close(force: true);
      });
      final events = <NativeHttpObservation>[];
      final url = Uri.parse('http://127.0.0.1:${server.port}/ok');
      final request = ObservedHttpRequest(
        'GET',
        url,
        onNativeObservation: events.add,
      )..followRedirects = false;
      final response = await http.Response.fromStream(
        await client.send(request),
      );
      expect(response.statusCode, 200);
      for (
        var i = 0;
        i < 100 && !events.any((e) => e.phase == 'native_task_metrics');
        i++
      ) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
      expect(
        events.map((e) => e.phase),
        containsAll([
          'native_task_started',
          'native_task_completed',
          'native_task_metrics',
        ]),
      );
      final metrics = events
          .firstWhere((e) => e.phase == 'native_task_metrics')
          .metrics!;
      expect(metrics, isNotEmpty);
      expect(
        metrics.first.keys,
        everyElement(
          isIn(const {
            'dnsMs',
            'connectMs',
            'tlsMs',
            'requestMs',
            'responseMs',
            'proxy',
            'reused',
            'cellular',
            'protocol',
          }),
        ),
      );
      expect(jsonEncode(metrics), isNot(contains('127.0.0.1')));

      final redirect = ObservedHttpRequest(
        'GET',
        url.replace(path: '/redirect'),
        onNativeObservation: (_) {},
      )..followRedirects = false;
      final redirected = await http.Response.fromStream(
        await client.send(redirect),
      );
      expect(
        redirected.statusCode,
        302,
        reason: 'the task delegate must not weaken redirect rejection',
      );
    },
    skip: !Platform.isMacOS,
  );

  test(
    'a stalled native task reports cancellation without a late successful result',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final accepted = Completer<void>(), release = Completer<void>();
      server.listen((request) async {
        accepted.complete();
        await release.future;
        try {
          request.response.write('{}');
          await request.response.close();
        } catch (_) {}
      });
      final client = FoundationHttpClient(
        URLSessionConfiguration.ephemeralSessionConfiguration(),
      );
      addTearDown(() async {
        if (!release.isCompleted) release.complete();
        client.close();
        await server.close(force: true);
      });
      final events = <NativeHttpObservation>[], abort = Completer<void>();
      final request = ObservedHttpRequest(
        'GET',
        Uri.parse('http://127.0.0.1:${server.port}/stall'),
        abortTrigger: abort.future,
        onNativeObservation: events.add,
      );
      final outcome = client
          .send(request)
          .then((_) => 'success', onError: (_) => 'failed');
      await accepted.future.timeout(const Duration(seconds: 3));
      abort.complete();
      expect(await outcome, 'failed');
      expect(events.map((e) => e.phase), contains('native_cancel_requested'));
      release.complete();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(
        events.where((e) => e.phase == 'native_task_completed').length,
        lessThanOrEqualTo(1),
      );
    },
    skip: !Platform.isMacOS,
  );
}
