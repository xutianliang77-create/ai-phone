import {describe,it,expect} from 'vitest';
import {selfHostedAdmission,selfHostedOwnerAllowed} from './self-hosted-admission.js';
describe('self hosted operational gate, separate from qualification',()=>{
 const clock=1800000000000;
 it('leaves the preserved legacy mode unchanged and defaults new Apple control closed',()=>{
  expect(selfHostedAdmission({},clock).open).toBe(true);expect(selfHostedAdmission({AUTH_PROVIDER:'apple'},clock).open).toBe(false);
 });
 it('accepts only an explicitly bounded current QA window and never extends it',()=>{
  const e={AUTH_PROVIDER:'apple',REALTIME_TOKEN_SECRET:'fixture-runtime-signing-secret-32b',INTERNAL_API_SECRET:'fixture-internal-signing-secret-32b',V10_SERVICE_ADMISSION_ENABLED:'true',V10_SERVICE_WINDOW_STARTS_AT:new Date(clock).toISOString(),V10_SERVICE_WINDOW_ENDS_AT:new Date(clock+60000).toISOString()};
  expect(selfHostedAdmission(e,clock).open).toBe(true);expect(selfHostedAdmission(e,clock+60000).open).toBe(false);
  expect(selfHostedAdmission({...e,V10_SERVICE_WINDOW_ENDS_AT:new Date(clock+3600001).toISOString()},clock).open).toBe(false);
 });
 it('keeps persistent release admission closed without a matching explicitly approved source reference',()=>{
  const e={AUTH_PROVIDER:'apple',REALTIME_TOKEN_SECRET:'fixture-runtime-signing-secret-32b',INTERNAL_API_SECRET:'fixture-internal-signing-secret-32b',V10_SERVICE_ADMISSION_ENABLED:'true',V10_SOURCE_MANIFEST_SHA256:'a'.repeat(64)};
  expect(selfHostedAdmission(e,clock).open).toBe(false);expect(selfHostedAdmission({...e,V10_RELEASE_APPROVED_SOURCE_SHA256:'b'.repeat(64)},clock).open).toBe(false);
  expect(selfHostedAdmission({...e,V10_RELEASE_APPROVED_SOURCE_SHA256:e.V10_SOURCE_MANIFEST_SHA256},clock).open).toBe(true);
  expect(selfHostedAdmission({...e,V10_RELEASE_APPROVED_SOURCE_SHA256:e.V10_SOURCE_MANIFEST_SHA256,V10_SERVICE_WINDOW_STARTS_AT:'invalid'},clock).open).toBe(false);
 });
 it('requires named QA accounts and never treats a wildcard or missing list as permission',()=>{
  const e={AUTH_PROVIDER:'apple',V10_SERVICE_WINDOW_STARTS_AT:'explicit-window'};
  expect(selfHostedOwnerAllowed('owner',e)).toBe(false);
  expect(selfHostedOwnerAllowed('owner',{...e,V10_QA_ALLOWED_ACCOUNT_IDS:'["*"]'})).toBe(false);
  expect(selfHostedOwnerAllowed('owner',{...e,V10_QA_ALLOWED_ACCOUNT_IDS:'["owner"]'})).toBe(true);
 });

});
