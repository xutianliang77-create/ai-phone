import 'package:flutter_test/flutter_test.dart';
import 'dart:convert';
import 'dart:io';
import 'package:translation_mobile/src/features/realtime/data/api/public_automatic_language_scope.dart';
import 'package:translation_mobile/src/features/realtime/data/api/public_creation_contract.dart';
import 'public_creation_client_test.dart' show offer;

Map<String,Object?> context({bool reverse=true}) => {...offer('owner',false),
  'automaticSourceLanguages':['zh','en','ja','fr','ko'],
  'capability':{'status':'qualified','automaticLanguage':true,'automaticReverse':reverse,
    'qualifiedLanguagePairs':[
      {'source':'zh','target':'en'},{'source':'en','target':'zh'},
      {'source':'ja','target':'zh'},{'source':'fr','target':'zh'},
    ]}};
void main(){
  test('third language translates to primary, not a guessed Chinese constant',(){
    expect(publicAutomaticTarget('ja','en',true,('zh','en')),'zh');
    expect(publicAutomaticTarget('ja','zh',true,('en','zh')),'zh');
    expect(publicAutomaticTarget('ja','en',true,('fr','en')),'fr');
    expect(publicAutomaticTarget('yue','en',true,('zh','en')),'en');
    expect(publicAutomaticTarget('fr','ja',false,null),'ja');
  });
  test('body binds the permitted multilingual source scope independently from reverse pair',(){
    final body=publicCreationBody(context(),deploymentId:'public',ownerId:'owner',mode:'conversation',source:'auto',target:'en',
      autoReverse:true,automaticLanguagePair:('zh','en'),voice:false);
    final language=(body['processing'] as Map)['languagePolicy'] as Map;
    expect(language['pair'],['zh','en']);expect(language['sourceLanguages'],['zh','en','ja','fr']);
    expect(language['sourceLanguages'],isNot(contains('ko'))); // Not qualified to the output language.
    expect(body,jsonDecode(File('test/fixtures/public_multilingual_request.json').readAsStringSync()));
  });
  test('fixed-target auto does not require a saved two-language pair',(){
    final body=publicCreationBody(context(reverse:false),deploymentId:'public',ownerId:'owner',mode:'conversation',source:'auto',target:'zh',
      autoReverse:false,automaticLanguagePair:null,voice:false);
    final language=(body['processing'] as Map)['languagePolicy'] as Map;
    expect(language.containsKey('pair'),isFalse);expect(language['sourceLanguages'],['zh','en','ja','fr']);
  });
  test('legacy server contract and unsupported capability remain unchanged',(){
    expect(publicAutomaticSources(offer('owner',false),target:'en',reverse:true,pair:('zh','en')),isNull);
    expect(()=>publicAutomaticSources({...context(),'automaticSourceLanguages':['ja','ja']},target:'zh',reverse:false,pair:null),throwsFormatException);
  });
}
