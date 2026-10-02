import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {repeatedAsrExpansion} from './repeated-transcript-expansion.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/longrun-repetition-0108.json',import.meta.url),'utf8'));
const input=(row:any)=>({text:row.text,timing:{startMs:row.startMs,endMs:row.endMs}});
const bad=input(fixture.segments[86]);
it('replays all 114 original raw finals: only the observed expanded repetition is quarantined',()=>{
  expect(createHash('sha256').update(bad.text).digest('hex')).toBe(fixture.anomalousRawSha256);
  const original=structuredClone(fixture);
  expect(fixture.segments.filter((row:any)=>repeatedAsrExpansion(input(row))).map((row:any)=>row.ordinal)).toEqual([87]);
  expect(repeatedAsrExpansion(bad)).toEqual({reason:'repeated_expansion',durationMs:5760,normalizedCharacters:254,repeatedCharacters:104});
  expect(fixture).toEqual(original);
});
it('keeps a genuinely long repeated passage with enough audio time, without deleting its repetitions',()=>{
  const passage={...bad,timing:{startMs:1000,endMs:61000}};
  expect(repeatedAsrExpansion(passage)).toBeUndefined();expect(passage.text).toBe(bad.text);
});
it.each(['好。','Okay.','不，不，不！','one two one two','こんにちは。','مرحبا','Qwen3 ASR，Hy-MT2，A-120。'])('preserves short answer/stutter/identifier %s',text=>{
  expect(repeatedAsrExpansion({text,timing:{startMs:0,endMs:100}})).toBeUndefined();
});
it('does not infer repetition from a previous turn/session or deduplicate legitimate new speech',()=>{
  for(let i=0;i<100;i++)expect(repeatedAsrExpansion({text:'请把会议纪要发给大家确认。',timing:{startMs:i*6000,endMs:i*6000+5000}})).toBeUndefined();
});
it('does not reject high-density unique content without substantial repeated spans',()=>{
  const text=Array.from({length:180},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
  expect(repeatedAsrExpansion({text,timing:{startMs:0,endMs:1000}})).toBeUndefined();
});
it.each([undefined,{startMs:1,endMs:1},{startMs:100,endMs:0},{startMs:-1,endMs:6000},{startMs:NaN,endMs:6000},{startMs:0,endMs:Infinity}])('does not invent a speech rate from unavailable timing %s',timing=>{
  expect(repeatedAsrExpansion({text:bad.text,timing})).toBeUndefined();
});
it.each([
  'The delivery address and the purchase order must be checked before the meeting.',
  'La dirección de entrega y el número del pedido deben confirmarse antes de la reunión.',
  'Перед встречей необходимо проверить адрес доставки и номер заказа.',
  'يجب التحقق من عنوان التسليم ورقم الطلب قبل الاجتماع.',
  '会議の前に配送先住所と注文番号を必ず確認してください。',
])('uses the same bounded predicate across scripts, not a Chinese/vendor word blacklist',sentence=>{
  const text=(sentence+' ').repeat(8);
  expect(repeatedAsrExpansion({text,timing:{startMs:0,endMs:1000}})?.reason).toBe('repeated_expansion');
  expect(repeatedAsrExpansion({text,timing:{startMs:0,endMs:120000}})).toBeUndefined();
});
it('normalizes Unicode/case for comparison only and keeps work bounded',()=>{
  const text='ﬃ'.repeat(50000),before=text;
  const result=repeatedAsrExpansion({text,timing:{startMs:0,endMs:1000}});
  expect(result?.normalizedCharacters).toBe(16384);expect(text).toBe(before);
});
it('preserves a repeated passage exactly at the conservative rate boundary',()=>{
  const text='请在开会前确认交付时间、收货地址、订单编号以及负责人的联系方式。'.repeat(8);
  const dense=repeatedAsrExpansion({text,timing:{startMs:0,endMs:1}})!;
  expect(dense).toBeDefined();
  expect(repeatedAsrExpansion({text,timing:{startMs:0,endMs:dense.normalizedCharacters*1000/40}})).toBeUndefined();
});
