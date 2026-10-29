import {build,version} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Browser/module resolution is required for PKI.js and WebCrypto in workerd.
// Node's default CJS resolution emits a dynamic require that workerd rejects.
if(version!=='0.28.1')throw Error('v10_exact_esbuild_version_required');
const output=process.argv[2];
if(!output||!path.isAbsolute(output)||process.argv.length!==3)throw Error('provide one absolute, new output path');
const root=path.dirname(fileURLToPath(import.meta.url));
const result=await build({entryPoints:[path.resolve(root,'../src/worker.mjs')],bundle:true,
 platform:'neutral',format:'esm',target:'es2022',mainFields:['module','main'],
 conditions:['browser','import'],external:['node:*'],write:false,metafile:true});
if(result.outputFiles.length!==1)throw Error('unexpected_worker_output');
await writeFile(output,result.outputFiles[0].contents,{flag:'wx'});
console.log(JSON.stringify({output,bytes:result.outputFiles[0].contents.length,esbuild:version,
 platform:'neutral',moduleResolution:'browser'}));
