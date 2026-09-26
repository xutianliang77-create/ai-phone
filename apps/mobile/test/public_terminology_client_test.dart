import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_contract.dart';
import 'public_creation_client_test.dart' show Harness, response;

void main() {
  test('public terms are enabled by default and cannot disappear from the signed response',() async {
    final h=Harness();addTearDown(h.close);
    await h.create().createSession();
    final request=h.requests.singleWhere((r)=>r.method=='POST'),body=jsonDecode(request.body) as Map;
    expect(body['termbaseId'],'default');expect(body['domainLexiconPacks'],['product']);
    final value=response(request,'owner'),parts=(value['realtimeToken'] as String).split('.');
    final claims=jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts.first)))) as Map;
    claims.remove('publicTerminologyHash');
    value['realtimeToken']='${base64Url.encode(utf8.encode(jsonEncode(claims))).replaceAll('=', '')}.${parts.last}';
    expect(()=>publicCreationResponse(value,{'body':body.cast<String,Object?>(),'endpoint':'wss://gateway.synthetic.invalid/realtime'},
      ownerId:'owner',deploymentId:'public'),throwsA(isA<FormatException>()));
  });
}
