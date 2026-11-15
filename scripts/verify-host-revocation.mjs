/**
 * External host revocation proof runner. The scoped account-exit mode
 * also records the check for an existing owner request. This only measures explicitly listed live routes;
 * it cannot establish universal CDN, third-party archive, or backup erasure.
 *
 * Example after host owner approval:
 * KADMEION_HOST_REVOCATION_PROBE_ENABLED=true \
 * KADMEION_RELEASE_HOST_ORIGIN=https://approved-host.example \
 * KADMEION_RELEASE_HOSTNAME=approved-host.example \
 * node --experimental-strip-types scripts/verify-host-revocation.mjs \
 * --canonical /owner/portfolio --direct /owner/portfolio/releases/hash/assets/hash.png
 */
import {attestAccountExitHostDenial,probeHostRevocation} from '../packages/storage-adapters/src/host-revocation-probe.ts';

function args(argv){
  let canonical, direct=[];
  for(let i=0;i<argv.length;i++){
    const key=argv[i],value=argv[++i];
    if(!value||value.startsWith('--'))throw Error('INVALID_ARGUMENTS');
    if(key==='--canonical'){
      if(canonical!==undefined)throw Error('INVALID_ARGUMENTS');
      canonical=value;
    }else if(key==='--direct')direct.push(value);
    else throw Error('INVALID_ARGUMENTS');
  }
  if(!canonical||direct.length<1||direct.length>12)throw Error('INVALID_ARGUMENTS');
  return {canonicalPath:canonical,candidateDirectPaths:direct};
}
async function main(){
  if(process.env.KADMEION_HOST_REVOCATION_PROBE_ENABLED!=='true')
    throw Error('PROBE_DISABLED');
  const origin=process.env.KADMEION_RELEASE_HOST_ORIGIN;
  const expected=process.env.KADMEION_RELEASE_HOSTNAME;
  if(!origin||!expected)throw Error('INVALID_HOST_CONFIGURATION');
  let url;
  try{url=new URL(origin);}catch{throw Error('INVALID_HOST_CONFIGURATION');}
  if(url.hostname!==expected||url.username||url.password||url.search||url.hash||
     url.pathname!=='/')
    throw Error('INVALID_HOST_CONFIGURATION');
  const argv=process.argv.slice(2);
  if(argv[0]==='--account-exit'){
    if(argv.length!==2||process.env.KADMEION_ACCOUNT_EXIT_HOST_RECEIPTS_ENABLED!=='true')
      throw Error('ACCOUNT_EXIT_RECEIPT_DISABLED');
    const endpoint=new URL(process.env.KADMEION_SUPABASE_URL??'');
    const key=process.env.KADMEION_SUPABASE_SERVICE_ROLE_KEY;
    const local=process.env.KADMEION_LOCAL_INTEGRATION==='1'&&endpoint.origin==='http://127.0.0.1:54321';
    if((!local&&endpoint.origin!=='https://scyooqjitjzjdxgtanso.supabase.co')||
       endpoint.pathname!=='/'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||
       typeof key!=='string'||!key.startsWith('eyJ')||key.length<70)
      throw Error('INVALID_BACKEND_CONFIGURATION');
    const result=await attestAccountExitHostDenial({requestId:argv[1],origin,allowLocal:local,
      rpc:async(operation,body)=>{
        const response=await fetch(new URL('/rest/v1/rpc/'+operation,endpoint),{
          method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
          headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
          signal:AbortSignal.timeout(10000),body:JSON.stringify(body)
        });
        if(!response.ok){
          await response.body?.cancel();
          throw Error('ACCOUNT_EXIT_PROOF_RPC_FAILED');
        }
        return response.json();
      }});
    process.stdout.write(JSON.stringify(result)+'\n');
    return;
  }
  const input={origin,allowLocal:process.env.KADMEION_LOCAL_INTEGRATION==='1',
    ...args(process.argv.slice(2))};
  const result=await probeHostRevocation(input);
  process.stdout.write(JSON.stringify(result)+'\n');
}
try{
  await main();
}catch(error){
  const code=error&&typeof error==='object'&&typeof error.code==='string'
    ?error.code
    :error instanceof Error&&/^[A-Z_]+$/.test(error.message)
      ?error.message:'VERIFICATION_FAILED';
  process.stderr.write('HOST_REVOCATION_PROBE_'+code+'\n');
  process.exitCode=1;
}
