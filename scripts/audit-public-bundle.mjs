/**
 * B0/P0 public build secret boundary: scan exactly the files destined to be
 * served to anonymous browsers. Never emit the matching value in exceptions.
 * This cannot replace dependency/SAST review or network inspection.
 */
import {readdir,readFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';

const MAX_FILES=300,MAX_FILE_BYTES=4*1024*1024,MAX_TOTAL=20*1024*1024;
const SAFE_EXTENSIONS=new Set(['.js','.css','.html','.json','.mjs','.map','.txt','.svg']);
const PRIVATE_MARKERS=[
  /sb_secret_[a-zA-Z0-9_-]{5,}/,
  /(?:KADMEION_|SUPABASE_)?SERVICE_ROLE_KEY/,
  /KADMEION_TRASH_SWEEP_SECRET/,
  /SUPABASE_DB_PASSWORD/,
  /(?:postgres|postgresql):\/\/[^\s"'<>]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
export class PublicBundleAuditError extends Error {
  constructor(code){
    super('Public browser artifact failed security audit: '+code);
    this.name='PublicBundleAuditError';
    this.code=code;
  }
}
/** No directory escapes or symlinks; bounded scan of final distribution bytes. */
export async function auditPublicBundle(directory){
  const root=resolve(directory);
  let seen=0,total=0;
  const visit=async(folder,depth)=>{
    if(depth>10)throw new PublicBundleAuditError('DIRECTORY_DEPTH');
    const entries=await readdir(folder,{withFileTypes:true});
    for(const entry of entries){
      if(entry.name==='.'||entry.name==='..')throw new PublicBundleAuditError('UNSAFE_PATH');
      const path=join(folder,entry.name);
      if(entry.isSymbolicLink())throw new PublicBundleAuditError('SYMLINK');
      if(entry.isDirectory()){
        await visit(path,depth+1);continue;
      }
      if(!entry.isFile())throw new PublicBundleAuditError('UNEXPECTED_FILE');
      if(++seen>MAX_FILES)throw new PublicBundleAuditError('FILE_LIMIT');
      const stat=await lstat(path);
      if(!stat.isFile()||stat.size>MAX_FILE_BYTES)
        throw new PublicBundleAuditError('FILE_SIZE');
      total+=stat.size;
      if(total>MAX_TOTAL)throw new PublicBundleAuditError('TOTAL_SIZE');
      const bytes=await readFile(path);
      // Also scan binary or unknown extensions: secret strings embedded in
      // images/archives would otherwise be copied into a browser asset.
      const content=bytes.toString('utf8');
      if(PRIVATE_MARKERS.some(marker=>marker.test(content)))
        throw new PublicBundleAuditError('PRIVATE_SECRET_MARKER');
      const known=[...SAFE_EXTENSIONS].some(ext=>entry.name.endsWith(ext));
      if(!known&&bytes.byteLength>MAX_FILE_BYTES)
        throw new PublicBundleAuditError('FILE_SIZE');
    }
  };
  await visit(root,0);
  if(!seen)throw new PublicBundleAuditError('EMPTY');
  return Object.freeze({status:'PUBLIC_ARTIFACT_SCANNED',filesChecked:seen,
    bytesChecked:total,serverSecretMarkerFound:false});
}
