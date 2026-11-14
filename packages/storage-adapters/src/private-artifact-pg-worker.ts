/**
 * SERVER ONLY: least-privileged node-postgres lifecycle for a PRIVATE
 * artifact binding. Never import from a browser entry point or a static app.
 * This is not a public release worker, host resolver, or publishing grant.
 */
import {Pool, type PoolConfig} from 'pg';
import {DirectSqlPrivateArtifactBindingWriter, type PrivatePgQueryPort}
  from './private-artifact-direct-sql-writer.ts';

export type PrivatePgWorkerErrorCode =
  'INVALID_CONFIGURATION'|'CONNECTION_UNAVAILABLE'|'ROLE_UNSAFE';

export class PrivatePgWorkerError extends Error {
  readonly code:PrivatePgWorkerErrorCode;
  constructor(code:PrivatePgWorkerErrorCode){
    super('Private PostgreSQL worker is unavailable or not authorized.');
    this.name='PrivatePgWorkerError';
    this.code=code;
  }
}
export interface PrivatePgWorkerOptions {
  host:string;port:number;database:string;user:string;password:string;
  /** Explicitly restricted to ephemeral local Supabase integration tests. */
  localOnly?:boolean;
  /** Required for remote connections; never permit rejectUnauthorized:false. */
  ssl?:{rejectUnauthorized:true;ca?:string};
}
export interface PrivatePgPoolPort extends PrivatePgQueryPort {
  on(event:'error',handler:(error:Error)=>void):unknown;
  end():Promise<void>;
}
export type PrivatePgPoolFactory=(config:PoolConfig)=>PrivatePgPoolPort;
export interface PrivateArtifactPgWorker {
  writer:DirectSqlPrivateArtifactBindingWriter;
  close():Promise<void>;
}
const ROLE=/^kd_[a-z][a-z0-9_]{2,62}$/;
const DB=/^[a-z][a-z0-9_]{0,62}$/;
const HOST=/^[a-z0-9][a-z0-9.-]{0,252}$/i;
const PROBE=`select current_user::text as role,
  (select rolsuper from pg_roles where rolname=current_user) as superuser,
  has_schema_privilege(current_user,'kadmeion_private','USAGE') as schema_usage,
  has_function_privilege(current_user,
    'kadmeion_private.bind_private_artifact_candidate(uuid,bigint,text,text)',
    'EXECUTE') as can_bind,
  has_table_privilege(current_user,
    'kadmeion_private.private_artifact_bindings','SELECT') as can_read,
  has_table_privilege(current_user,
    'public.private_release_visibility_pointers','UPDATE') as can_mutate`;

function configFor(options:PrivatePgWorkerOptions):PoolConfig {
  if(!options||typeof options.host!=='string'||
     !(HOST.test(options.host)||options.host==='::1')||
     !Number.isInteger(options.port)||options.port<1||options.port>65535||
     typeof options.database!=='string'||!DB.test(options.database)||
     typeof options.user!=='string'||!ROLE.test(options.user)||
     typeof options.password!=='string'||options.password.length<16)
    throw new PrivatePgWorkerError('INVALID_CONFIGURATION');
  const local=['127.0.0.1','localhost','::1'].includes(options.host);
  if(local){
    if(options.localOnly!==true||
       process.env.KADMEION_LOCAL_INTEGRATION!=='1'||options.ssl!==undefined)
      throw new PrivatePgWorkerError('INVALID_CONFIGURATION');
  }else if(options.localOnly===true||options.ssl?.rejectUnauthorized!==true||
           (options.ssl.ca!==undefined&&
            (typeof options.ssl.ca!=='string'||options.ssl.ca.length===0)))
    throw new PrivatePgWorkerError('INVALID_CONFIGURATION');
  // Do not parse arbitrary DATABASE_URL parameters or inherit PG* credentials.
  return {
    host:options.host,port:options.port,database:options.database,
    user:options.user,password:options.password,
    ssl:local?false:{rejectUnauthorized:true,...options.ssl},
    max:1,min:0,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,
    query_timeout:10000,statement_timeout:10000,lock_timeout:3000,
    allowExitOnIdle:true,application_name:'kadmeion-private-artifact-worker'
  };
}

/** Probe privileges BEFORE accepting any binding work; fail closed on error. */
export async function openPrivateArtifactPgWorker(
  options:PrivatePgWorkerOptions,
  poolFactory:PrivatePgPoolFactory=(config)=>new Pool(config)
):Promise<PrivateArtifactPgWorker>{
  const config=configFor(options);
  let pool:PrivatePgPoolPort;
  try{
    pool=poolFactory(config);
    if(!pool||typeof pool.query!=='function'||
       typeof pool.on!=='function'||typeof pool.end!=='function')
      throw new Error('Invalid pool');
  }catch{
    throw new PrivatePgWorkerError('CONNECTION_UNAVAILABLE');
  }
  try{
    // Avoid an unhandled EventEmitter error; never log driver errors or secrets.
    pool.on('error',()=>{});
    const result=await pool.query(PROBE,[]);
    const row=result?.rows?.[0];
    if(!result||result.rows.length!==1||!row||
       typeof row!=='object'||Array.isArray(row)){
      throw new PrivatePgWorkerError('ROLE_UNSAFE');
    }
    const r=row as Record<string,unknown>;
    if(r.role!==options.user||r.superuser!==false||
       r.schema_usage!==true||r.can_bind!==true||
       r.can_read!==false||r.can_mutate!==false)
      throw new PrivatePgWorkerError('ROLE_UNSAFE');
  }catch(error){
    try{await pool.end();}catch{/* preserve sanitized failure */}
    if(error instanceof PrivatePgWorkerError)throw error;
    throw new PrivatePgWorkerError('CONNECTION_UNAVAILABLE');
  }
  let closed=false;
  let closing:Promise<void>|undefined;
  const writer=new DirectSqlPrivateArtifactBindingWriter({
    query:async(sql,params)=>{
      if(closed)throw new PrivatePgWorkerError('CONNECTION_UNAVAILABLE');
      return pool.query(sql,params);
    }
  });
  return {
    writer,
    close(){
      if(!closing){
        closed=true;
        closing=pool.end().catch(()=>{
          throw new PrivatePgWorkerError('CONNECTION_UNAVAILABLE');
        });
      }
      return closing;
    }
  };
}
