import {requirePublicDocuments} from '../../v10-cloudflare-control/vendor/reused-control-core.mjs';
export function documents(env,path,head){const set=requirePublicDocuments(env),kind=({'/privacy':'privacy','/terms':'terms','/support':'account','/refund':'account','/account/delete':'account','/providers':'providers','/permissions':'permissions'})[path];
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const chosen=kind?set.documents.filter(d=>d.kind===kind):set.documents;
 const html='<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>无界 AI 1.0</title><h1>无界 AI 1.0'+(set.approvalRef?'':' · QA文档草案')+'</h1><p>'+escape(set.legalEntity)+'</p>'+chosen.map(d=>'<h2>'+escape(d.zhTitle)+'</h2>'+d.zhSections.map(s=>'<h3>'+escape(s.title)+'</h3><p>'+escape(s.body)+'</p>').join('')).join('')+'<p>'+escape(set.supportEmail)+'</p></html>';
 return new Response(head?null:html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
}
