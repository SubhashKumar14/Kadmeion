/**
 * INTERNAL server-only denial adapter. No public hosting authority, bytes,
 * service-role secret, signed URL or HTTP response is supplied by this module.
 * A trusted host must separately prove route and asset interception.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const ASSET=new RegExp('^assets/([0-9a-f]{64})[.](css|png|jpg|jpeg|webp|woff2)$');
const record=(x:unknown):x is Record<string,unknown>=>
  x!==null&&typeof x==='object'&&!Array.isArray(x);
export type PrivateGateRequest=
  | {portfolioId:string;resource:'CANONICAL_HTML'}
  | {portfolioId:string;resource:'DIRECT_ASSET';releaseSha256:string;path:string;sha256:string};
export type PrivateGateReason=
  'INVALID_REQUEST'|'PROVIDER_UNAVAILABLE'|'STATE_UNVERIFIED'|
  'NO_VERIFIED_PUBLIC_RELEASE'|'PRIVATE_POINTER_BLOCKED';
export interface PrivateGateDeny {
  status:'DENY';reason:PrivateGateReason;
  generation:number;revocationGeneration:number;
  servingAllowed:false;publicUrl:null;hostRevocationVerified:false;
}
export interface TrustedPrivateDenialReader {
  /** Query the restricted DB for every request; never accept browser-supplied state. */
  readDenial(request:PrivateGateRequest):Promise<unknown>;
}
function validRequest(x:unknown):x is PrivateGateRequest{
  if(!record(x)||typeof x.portfolioId!=='string'||!UUID.test(x.portfolioId))
    return false;
  if(x.resource==='CANONICAL_HTML')return Object.keys(x).length===2;
  if(x.resource!=='DIRECT_ASSET'||Object.keys(x).length!==5||
     typeof x.releaseSha256!=='string'||!SHA.test(x.releaseSha256)||
     typeof x.sha256!=='string'||!SHA.test(x.sha256)||
     typeof x.path!=='string')return false;
  const match=ASSET.exec(x.path);
  return match!==null&&match[1]===x.sha256;
}
const deny=(reason:PrivateGateReason,generation=0,revocationGeneration=0):
  PrivateGateDeny=>({status:'DENY',reason,generation,revocationGeneration,
    servingAllowed:false,publicUrl:null,hostRevocationVerified:false});
export class PrivateServerDeliveryDenialGate {
  constructor(private readonly reader:TrustedPrivateDenialReader){}
  async check(request:unknown):Promise<PrivateGateDeny>{
    if(!validRequest(request))return deny('INVALID_REQUEST');
    let raw:unknown;
    try {raw=await this.reader.readDenial(request);}
    catch{return deny('PROVIDER_UNAVAILABLE');}
    if(!record(raw)||Object.keys(raw).length!==9||
       raw.portfolioId!==request.portfolioId||raw.resource!==request.resource||
       raw.status!=='DENY'||
       (raw.reason!=='INVALID_REQUEST'&&raw.reason!=='NO_VERIFIED_PUBLIC_RELEASE'&&
        raw.reason!=='PRIVATE_POINTER_BLOCKED')||
       typeof raw.generation!=='number'||!Number.isSafeInteger(raw.generation)||
       raw.generation<0||
       typeof raw.revocationGeneration!=='number'||
       !Number.isSafeInteger(raw.revocationGeneration)||
       raw.revocationGeneration<0||raw.revocationGeneration>raw.generation||
       raw.servingAllowed!==false||raw.publicUrl!==null||
       raw.hostRevocationVerified!==false)
      return deny('STATE_UNVERIFIED');
    return deny(raw.reason as PrivateGateReason,
      raw.generation as number,raw.revocationGeneration as number);
  }
}
