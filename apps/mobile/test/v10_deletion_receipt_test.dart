import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/account/data/deletion_receipt_store.dart';

void main(){
 TestWidgetsFlutterBinding.ensureInitialized();
 const channel=MethodChannel('fixture/deletion-receipts');
 final messenger=TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
 final values=<String,String>{};
 setUp(()=>messenger.setMockMethodCallHandler(channel,(c) async{
  final args=Map<String,Object?>.from(c.arguments as Map),key=args['key'] as String;
  if(c.method=='credentialRead')return values[key];
  if(c.method=='credentialWrite'){values[key]=args['value'] as String;return null;}
  throw StateError('unexpected method');
 }));
 tearDown((){values.clear();messenger.setMockMethodCallHandler(channel,null);});
 test('receipt capabilities survive reload, stay scoped, and can be removed',() async{
  final a=KeychainDeletionReceiptStore(baseUrl:Uri.parse('https://fixture.invalid'),deploymentId:'fixture',channel:channel);
  final first=await a.create(),second=await a.create();
  expect(first.secret,isNot(second.secret));
  expect(first.secret, matches(RegExp(r'^[A-Za-z0-9_-]{43}$')));
  expect(first.receiptHash,sha256.convert(utf8.encode('v10-deletion:${first.secret}')).toString());
  expect((await a.load()).map((r)=>r.secret),[first.secret,second.secret]);
  final other=KeychainDeletionReceiptStore(baseUrl:Uri.parse('https://other.invalid'),deploymentId:'fixture',channel:channel);
  expect(await other.load(),isEmpty);
  await a.remove(first.secret);
  expect((await a.load()).single.secret,second.secret);
 });
 test('concurrent writes retain both receipt capabilities',() async{
  final a=KeychainDeletionReceiptStore(baseUrl:Uri.parse('https://fixture.invalid'),deploymentId:'fixture',channel:channel);
  final items=await Future.wait([a.create(),a.create()]);
  expect((await a.load()).map((e)=>e.secret).toSet(),items.map((e)=>e.secret).toSet());
 });
}
