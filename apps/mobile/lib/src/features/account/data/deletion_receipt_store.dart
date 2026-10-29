import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'account_session_store.dart';

class DeletionReceipt {
  const DeletionReceipt(this.secret, this.createdAt);
  final String secret;
  final DateTime createdAt;
  String get receiptHash => sha256.convert(utf8.encode('v10-deletion:$secret')).toString();
}

abstract interface class DeletionReceiptStorage {
  Future<List<DeletionReceipt>> load();
  Future<DeletionReceipt> create();
  Future<void> remove(String secret);
}

/// A separate, read-only capability; it is never an account bearer token.
/// Native Keychain marks the item ThisDeviceOnly. Records and backups are not touched.
class KeychainDeletionReceiptStore implements DeletionReceiptStorage {
  KeychainDeletionReceiptStore({required Uri baseUrl,required String deploymentId,MethodChannel? channel})
      : _key=AccountRequestScope(deploymentId:deploymentId,ownerId:'v10-deletion-receipts',apiBaseUrl:baseUrl).storageKey,
        _channel=channel??const MethodChannel('translation_mobile/apple_account');
  final String _key;
  final MethodChannel _channel;
  static final _writes=<String,Future<void>>{};

  @override Future<List<DeletionReceipt>> load() async {
    final raw=await _channel.invokeMethod<String>('credentialRead',{'key':_key});
    if(raw==null)return [];
    final data=jsonDecode(raw);
    if(data is! List || data.length>20)throw StateError('deletion_receipt_storage_invalid');
    return data.map((item){
      if(item is! Map||item['secret'] is! String||item['createdAt'] is! String||
          !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(item['secret'] as String)) {
        throw StateError('deletion_receipt_storage_invalid');
      }
      final date=DateTime.tryParse(item['createdAt'] as String);
      if(date==null)throw StateError('deletion_receipt_storage_invalid');
      return DeletionReceipt(item['secret'] as String,date);
    }).toList();
  }

  @override Future<DeletionReceipt> create() async {
    final previous=_writes[_key]??Future<void>.value(),done=Completer<void>();
    _writes[_key]=done.future;
    await previous.catchError((Object _){});
    try{
      final items=await load();
      if(items.length>=20)throw StateError('deletion_receipt_storage_full');
      final random=Random.secure(),bytes=List<int>.generate(32,(_)=>random.nextInt(256));
      final receipt=DeletionReceipt(base64Url.encode(bytes).replaceAll('=',''),DateTime.now().toUtc());
      await _channel.invokeMethod<void>('credentialWrite',{'key':_key,'value':jsonEncode([
        ...items.map((e)=>{'secret':e.secret,'createdAt':e.createdAt.toIso8601String()}),
        {'secret':receipt.secret,'createdAt':receipt.createdAt.toIso8601String()},
      ])});
      return receipt;
    } finally {done.complete();if(identical(_writes[_key],done.future))_writes.remove(_key);}
  }

  @override Future<void> remove(String secret) async {
    final previous=_writes[_key]??Future<void>.value(),done=Completer<void>();
    _writes[_key]=done.future;
    await previous.catchError((Object _){});
    try {
      final items=await load();
      await _channel.invokeMethod<void>('credentialWrite',{'key':_key,'value':jsonEncode([
        ...items.where((e)=>e.secret!=secret).map((e)=>{'secret':e.secret,'createdAt':e.createdAt.toIso8601String()}),
      ])});
    } finally {done.complete();if(identical(_writes[_key],done.future))_writes.remove(_key);}
  }
}
