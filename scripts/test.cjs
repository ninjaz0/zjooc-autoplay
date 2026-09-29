const {spawnSync}=require('node:child_process');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
for(const args of [['--check','extension/core.js'],['--check','extension/content.js'],['tests/playlist.cjs'],['tests/health.cjs'],['tests/recovery.cjs']]){
 const run=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});
 if(run.error)throw run.error;
 if(run.status!==0)process.exit(run.status||1);
}
