/**
 * Server-only PostgreSQL adapter for the private, NON-PUBLISHING artifact
 * binding function. This file must never be exported by the browser package.
 *
 * Supply a direct PostgreSQL Pool/Client (for example from node-postgres)
 * configured by a trusted worker with a least-privileged DB role granted
 * EXECUTE on kadmeion_private.bind_private_artifact_candidate. Do not use
 * Supabase PostgREST, a public API key, or a browser Supabase client here.
 *
 * The SQL function atomically checks frozen source, current pointer generation
 * and exact manifest/HTML hashes. This adapter does not attest renderer origin:
 * call it only through bindPrivateArtifactToPointer with a trusted plan.
 */
import type { TrustedPrivateBindingRequest, TrustedPrivateBindingWriter }
  from './private-artifact-pointer-binding.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SQL=`select kadmeion_private.bind_private_artifact_candidate(
  $1::uuid, $2::bigint, $3::text, $4::text
) as receipt`;

/** Structural port compatible with pg.Pool.query and pg.Client.query. */
export interface PrivatePgQueryPort {
  query(sql:string,params:unknown[]):Promise<{rows:unknown[]}>;
}

export class PrivateArtifactSqlBindingError extends Error {
  readonly code:'INVALID_INPUT'|'SQL_UNCONFIRMED'|'INVALID_SQL_RECEIPT';
  constructor(code:PrivateArtifactSqlBindingError['code']) {
    super(code==='INVALID_INPUT'?'Invalid private artifact SQL binding request.'
      :'Private artifact SQL binding was not confirmed.');
    this.name='PrivateArtifactSqlBindingError';this.code=code;
  }
}

/** A single parameterized statement is one PostgreSQL atomic transaction. */
export class DirectSqlPrivateArtifactBindingWriter implements TrustedPrivateBindingWriter {
  private readonly db:PrivatePgQueryPort;
  constructor(db:PrivatePgQueryPort){
    if(!db||typeof db.query!=='function')
      throw new PrivateArtifactSqlBindingError('INVALID_INPUT');
    this.db=db;
  }
  async bindPrivateArtifact(request:TrustedPrivateBindingRequest):Promise<unknown>{
    if(!request||!UUID.test(request.requestId)||
       !Number.isSafeInteger(request.expectedGeneration)||
       request.expectedGeneration<1||
       typeof request.manifestJson!=='string'||
       typeof request.html!=='string'||
       request.manifestJson.includes('\0')||request.html.includes('\0'))
      throw new PrivateArtifactSqlBindingError('INVALID_INPUT');
    const encoder=new TextEncoder();
    const manifestBytes=encoder.encode(request.manifestJson).byteLength;
    const htmlBytes=encoder.encode(request.html).byteLength;
    if(manifestBytes<2||manifestBytes>8192||htmlBytes<1||htmlBytes>750000)
      throw new PrivateArtifactSqlBindingError('INVALID_INPUT');
    let result:{rows:unknown[]};
    try{
      result=await this.db.query(SQL,[request.requestId,
        request.expectedGeneration,request.manifestJson,request.html]);
    }catch{
      // Never expose connection strings, query arguments or provider diagnostics.
      throw new PrivateArtifactSqlBindingError('SQL_UNCONFIRMED');
    }
    if(!result||!Array.isArray(result.rows)||result.rows.length!==1||
       !result.rows[0]||typeof result.rows[0]!=='object'||
       Array.isArray(result.rows[0])||
       !Object.prototype.hasOwnProperty.call(result.rows[0],'receipt'))
      throw new PrivateArtifactSqlBindingError('INVALID_SQL_RECEIPT');
    // Do not trust the receipt here: the upstream orchestrator validates all
    // 11 fields against its independently rebuilt artifact and pointer.
    return (result.rows[0] as {receipt:unknown}).receipt;
  }
}
