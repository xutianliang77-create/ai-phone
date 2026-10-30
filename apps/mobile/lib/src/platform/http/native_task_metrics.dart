import 'dart:ffi' as ffi;
import 'dart:io';

// The locked cupertino_http 3.1.0 exposes the delegate but its public wrapper
// omits metrics. Use its generated delegate binding without changing sessions.
// ignore: implementation_imports
import 'package:cupertino_http/src/native_cupertino_bindings.dart' as native;
import 'package:objective_c/objective_c.dart' as objc;

typedef _ObjectPointer = ffi.Pointer<objc.ObjCObjectImpl>;
typedef _SelectorPointer = ffi.Pointer<objc.ObjCSelector>;
typedef _SendObjectNative =
    _ObjectPointer Function(_ObjectPointer, _SelectorPointer);
typedef _SendObjectDart =
    _ObjectPointer Function(_ObjectPointer, _SelectorPointer);
typedef _SendBoolNative = ffi.Int8 Function(_ObjectPointer, _SelectorPointer);
typedef _SendBoolDart = int Function(_ObjectPointer, _SelectorPointer);

final _sendObject = objc.msgSendPointer
    .cast<ffi.NativeFunction<_SendObjectNative>>()
    .asFunction<_SendObjectDart>();
final _sendBool = objc.msgSendPointer
    .cast<ffi.NativeFunction<_SendBoolNative>>()
    .asFunction<_SendBoolDart>();

_ObjectPointer _object(_ObjectPointer receiver, String name) {
  final selector = objc.registerName(name);
  return objc.respondsToSelector(receiver, selector)
      ? _sendObject(receiver, selector)
      : ffi.nullptr;
}

bool? _boolean(_ObjectPointer receiver, String name) {
  final selector = objc.registerName(name);
  return objc.respondsToSelector(receiver, selector)
      ? _sendBool(receiver, selector) != 0
      : null;
}

double? _date(_ObjectPointer receiver, String name) {
  final pointer = _object(receiver, name);
  if (pointer == ffi.nullptr) return null;
  return objc.NSDate.fromPointer(
    pointer,
    retain: true,
    release: true,
  ).timeIntervalSince1970;
}

int? _duration(_ObjectPointer receiver, String start, String end) {
  final a = _date(receiver, start), b = _date(receiver, end);
  if (a == null || b == null || !a.isFinite || !b.isFinite) return null;
  final ms = ((b - a) * 1000).round();
  return ms >= 0 && ms <= 300000 ? ms : null;
}

String? _protocol(_ObjectPointer receiver) {
  final pointer = _object(receiver, 'networkProtocolName');
  if (pointer == ffi.nullptr) return null;
  final name = objc.NSString.fromPointer(
    pointer,
    retain: true,
    release: true,
  ).toDartString().toLowerCase();
  return const {'http/1.1', 'h2', 'h3'}.contains(name) ? name : 'other';
}

/// Extract numeric/boolean connection facts only; never inspect URL, IP,
/// headers, bodies, certificates, account identifiers or response contents.
List<Map<String, Object?>> _facts(native.NSURLSessionTaskMetrics metrics) {
  final pointer = _object(metrics.object$.ref.pointer, 'transactionMetrics');
  if (pointer == ffi.nullptr) return const [];
  final transactions = objc.NSArray.fromPointer(
    pointer,
    retain: true,
    release: true,
  ).asDart();
  return [
    for (final entry in transactions.take(8))
      () {
        final p = entry.ref.pointer;
        final dns = _duration(
          p,
          'domainLookupStartDate',
          'domainLookupEndDate',
        );
        final connect = _duration(p, 'connectStartDate', 'connectEndDate');
        final tls = _duration(
          p,
          'secureConnectionStartDate',
          'secureConnectionEndDate',
        );
        final request = _duration(p, 'requestStartDate', 'requestEndDate');
        final response = _duration(p, 'responseStartDate', 'responseEndDate');
        final proxy = _boolean(p, 'isProxyConnection');
        final reused = _boolean(p, 'isReusedConnection');
        final cellular = _boolean(p, 'isCellular');
        final protocol = _protocol(p);
        return <String, Object?>{
          if (dns != null) 'dnsMs': dns,
          if (connect != null) 'connectMs': connect,
          if (tls != null) 'tlsMs': tls,
          if (request != null) 'requestMs': request,
          if (response != null) 'responseMs': response,
          if (proxy != null) 'proxy': proxy,
          if (reused != null) 'reused': reused,
          if (cellular != null) 'cellular': cellular,
          if (protocol != null) 'protocol': protocol,
        };
      }(),
  ];
}

/// Only QA builds attach this task-specific delegate. Other session-delegate
/// methods (including redirect rejection) continue to use the original client.
native.NSURLSessionTaskDelegate? createNativeMetricsDelegate(
  void Function(List<Map<String, Object?>>) onMetrics,
) {
  if (!Platform.isIOS && !Platform.isMacOS) return null;
  try {
    final builder = objc.ObjCProtocolBuilder();
    native
        .NSURLSessionDataDelegate$Builder
        .URLSession_task_didFinishCollectingMetrics_
        .implementAsListener(builder, (_, __, metrics) {
          try {
            onMetrics(_facts(metrics));
          } catch (_) {
            /* diagnostic only */
          }
        });
    return native.NSURLSessionTaskDelegate.as(builder.build());
  } catch (_) {
    // Diagnostics cannot make an otherwise valid request fail.
    return null;
  }
}
