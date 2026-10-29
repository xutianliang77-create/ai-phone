import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/account/data/account_api_client.dart';
import 'package:translation_mobile/src/features/account/data/account_session_store.dart';
import 'package:translation_mobile/src/features/account/data/deletion_receipt_store.dart';
import 'package:translation_mobile/src/features/account/presentation/pages/account_page.dart';

class _Receipts implements DeletionReceiptStorage {
  final records=<DeletionReceipt>[];
  @override Future<List<DeletionReceipt>> load() async => List.of(records);
  @override Future<DeletionReceipt> create() async {
    final value=DeletionReceipt('A'*43,DateTime.utc(2026,10,29));records.add(value);return value;
  }
  @override Future<void> remove(String secret) async => records.removeWhere((r)=>r.secret==secret);
}
class _Client extends AccountApiClient {
  _Client():super(baseUrl:Uri.parse('https://fixture.invalid'),deploymentId:'fixture');
  String? sentHash;bool fail=false;String status='processing';
  @override Future<AccountProfile> fetchMe(String token) async => AccountProfile(id:'synthetic',phoneMasked:'',status:'active',createdAt:DateTime.utc(2026));
  @override Future<AccountProfile> requestDeviceDeletion(String token,{required String receiptHash}) async {
    sentHash=receiptHash;
    if(fail)throw const AccountApiException('synthetic failure',{});
    return AccountProfile(id:'synthetic',phoneMasked:'',status:'deletion_requested',createdAt:DateTime.utc(2026));
  }
  @override Future<Map<String,Object?>> deletionStatus(String secret) async => {'status':status,'appleRevocation':'confirmed'};
}

void main(){
  testWidgets('deletion keeps a separate receipt and displays completion without another login', (t) async {
    expect(onDeviceExecution,true);
    final client=_Client(),receipts=_Receipts(),account=MemoryAccountSessionStore(const AccountSession(
      token:'synthetic',ownerId:'synthetic',deploymentId:'fixture',issuerOrigin:'https://fixture.invalid',expiresAtIso:'2099-01-01T00:00:00Z'));
    await t.pumpWidget(MaterialApp(home:AccountPage(client:client,sessionStore:account,deletionReceipts:receipts)));
    await t.pumpAndSettle();await t.tap(find.text('注销账号'));await t.pumpAndSettle();
    await t.tap(find.text('确认注销'));await t.pumpAndSettle();
    expect(client.sentHash,receipts.records.single.receiptHash);expect(account.session,isNull);
    expect(find.text('注销处理中。'),findsOneWidget);expect(find.text(receipts.records.single.secret),findsNothing);
    client.status='completed';await t.tap(find.text('刷新注销进度'));await t.pumpAndSettle();
    expect(find.textContaining('账号身份已注销且 Apple 登录授权已撤销'),findsOneWidget);
  });
  testWidgets('a failed or unknown submission retains the receipt and does not log out', (t) async {
    final client=_Client()..fail=true..status='not_submitted',receipts=_Receipts(),account=MemoryAccountSessionStore(const AccountSession(
      token:'synthetic',ownerId:'synthetic',deploymentId:'fixture',issuerOrigin:'https://fixture.invalid',expiresAtIso:'2099-01-01T00:00:00Z'));
    await t.pumpWidget(MaterialApp(home:AccountPage(client:client,sessionStore:account,deletionReceipts:receipts)));
    await t.pumpAndSettle();await t.tap(find.text('注销账号'));await t.pumpAndSettle();
    await t.tap(find.text('确认注销'));await t.pumpAndSettle();
    expect(account.session,isNotNull);expect(receipts.records,hasLength(1));
    expect(find.textContaining('未查到已提交的注销请求'),findsOneWidget);
  });
}
