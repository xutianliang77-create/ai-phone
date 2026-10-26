import {AppleIdentityError} from './apple-identity.js';
export function text(value:string,maximum=160){
  if(typeof value!=='string'||!value.length||Buffer.byteLength(value)>maximum)throw new AppleIdentityError('apple_invalid_input');return value;
}
export function integer(value:number,minimum=0){
  if(!Number.isSafeInteger(value)||value<minimum)throw new AppleIdentityError('apple_invalid_input');return value;
}
export function digest(value:string){if(!/^[a-f0-9]{64}$/.test(value))throw new AppleIdentityError('apple_invalid_digest');return value;}
