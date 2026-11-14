/**
 * Owner-JWT-only private Growth goals. Progress is deliberately MANUAL;
 * no provider facts, public analytics, fabricated scores or verification
 * claims are introduced by this adapter.
 *
 * The PostgREST tables enforce ownership via PostgreSQL RLS and column grants.
 * Bounded receipts and exact idempotency IDs protect UI state from optimistic
 * or cross-tenant success claims.
 */
export type GoalStatus='ACTIVE'|'PAUSED'|'COMPLETED'|'ARCHIVED';
export interface PrivateGoal {
  id:string;owner_user_id:string;operation_id:string;title:string;description:string;
  target_value:number|null;unit:string|null;due_on:string|null;status:GoalStatus;
  created_at:string;updated_at:string;
}
export interface GoalProgress {
  id:string;goal_id:string;owner_user_id:string;operation_id:string;
  value:number;note:string;source:'MANUAL';created_at:string;
}
export interface GoalMilestone {
  id:string;goal_id:string;owner_user_id:string;operation_id:string;
  title:string;due_on:string|null;completed_at:string|null;created_at:string;
}
export type GoalUpdate=Partial<Pick<PrivateGoal,'title'|'description'|'target_value'|'unit'|'due_on'|'status'>>;
export class PrivateGoalsError extends Error {
  readonly code:'VALIDATION'|'AUTH_EXPIRED'|'FORBIDDEN'|'CONFLICT'|'PROVIDER_UNAVAILABLE'|
    'INVALID_ACK'|'LIMIT_EXCEEDED';
  constructor(code:PrivateGoalsError['code']){
    super('Private goals operation could not be completed: '+code);
    this.name='PrivateGoalsError';this.code=code;
  }
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY=512*1024;
const object=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validId=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
function validText(value:unknown,min:number,max:number):value is string {
  return typeof value==='string'&&value.length>=min&&value.length<=max&&
    (min===0||value.trim().length>0)&&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function date(value:unknown):value is string {
  return typeof value==='string'&&/^\d{4}-\d\d-\d\d$/.test(value)&&
    !Number.isNaN(Date.parse(value))&&
    new Date(value).toISOString().slice(0,10)===value;
}
function timestamp(value:unknown):value is string {
  return typeof value==='string'&&value.length<=64&&!Number.isNaN(Date.parse(value));
}
function numeric(value:unknown):value is number {
  return typeof value==='number'&&Number.isFinite(value)&&value>=0&&
    value<=9999999999.99&&Number(value.toFixed(2))===value;
}
const goalStatuses=new Set<GoalStatus>(['ACTIVE','PAUSED','COMPLETED','ARCHIVED']);
function validGoal(value:unknown):value is PrivateGoal {
  if(!object(value))return false;
  return Object.keys(value).sort().join(',')===
    'created_at,description,due_on,id,operation_id,owner_user_id,status,target_value,title,unit,updated_at'&&
    validId(value.id)&&validId(value.owner_user_id)&&validId(value.operation_id)&&
    validText(value.title,1,160)&&validText(value.description,0,2000)&&
    (value.target_value===null||(numeric(value.target_value)&&value.target_value>0))&&
    (value.unit===null&&value.target_value===null ||
      (value.unit===null||validText(value.unit,1,32)))&&
    (value.due_on===null||date(value.due_on))&&
    goalStatuses.has(value.status as GoalStatus)&&
    timestamp(value.created_at)&&timestamp(value.updated_at);
}
function validProgress(value:unknown):value is GoalProgress {
  if(!object(value)||Object.keys(value).sort().join(',')!==
    'created_at,goal_id,id,note,operation_id,owner_user_id,source,value')return false;
  return validId(value.id)&&validId(value.goal_id)&&validId(value.owner_user_id)&&
    validId(value.operation_id)&&numeric(value.value)&&
    validText(value.note,0,500)&&value.source==='MANUAL'&&timestamp(value.created_at);
}
function validMilestone(value:unknown):value is GoalMilestone {
  if(!object(value)||Object.keys(value).sort().join(',')!==
    'completed_at,created_at,due_on,goal_id,id,operation_id,owner_user_id,title')return false;
  return validId(value.id)&&validId(value.goal_id)&&validId(value.owner_user_id)&&
    validId(value.operation_id)&&validText(value.title,1,160)&&
    (value.due_on===null||date(value.due_on))&&
    (value.completed_at===null||timestamp(value.completed_at))&&timestamp(value.created_at);
}
async function responseJson(response:Response):Promise<unknown> {
  const type=response.headers.get('content-type');
  if(!type||!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:\s*;|$)/i.test(type))
    throw new PrivateGoalsError('INVALID_ACK');
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_BODY))
    throw new PrivateGoalsError('LIMIT_EXCEEDED');
  if(!response.body)throw new PrivateGoalsError('INVALID_ACK');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
  try{
    for(;;){
      const item=await reader.read();
      if(item.done)break;
      if(!(item.value instanceof Uint8Array))throw new PrivateGoalsError('INVALID_ACK');
      total+=item.value.byteLength;
      if(total>MAX_BODY){await reader.cancel();throw new PrivateGoalsError('LIMIT_EXCEEDED');}
      parts.push(item.value);
    }
  }finally{reader.releaseLock();}
  const encoding=response.headers.get('content-encoding');
  if(length!==null&&(!encoding||encoding.toLowerCase()==='identity')&&total!==Number(length))
    throw new PrivateGoalsError('INVALID_ACK');
  const buffer=new Uint8Array(total);let offset=0;
  for(const part of parts){buffer.set(part,offset);offset+=part.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer)) as unknown;}
  catch{throw new PrivateGoalsError('INVALID_ACK');}
}
export class SupabasePrivateGoalsService {
  private readonly origin:string;
  private readonly key:string;
  private readonly token:()=>Promise<string|null>;
  private readonly http:typeof fetch;
  constructor(endpoint:string,publishableKey:string,token:()=>Promise<string|null>,
    http:typeof fetch=fetch){
    let url:URL;
    try{url=new URL(endpoint);}catch{throw new PrivateGoalsError('VALIDATION');}
    if((url.protocol!=='https:'&&!(url.protocol==='http:'&&
       ['127.0.0.1','localhost'].includes(url.hostname)))||
       url.username||url.password||url.pathname!=='/'||url.search||url.hash||
       typeof publishableKey!=='string'||!publishableKey.trim())
      throw new PrivateGoalsError('VALIDATION');
    this.origin=url.origin;this.key=publishableKey;this.token=token;this.http=http;
  }
  private async send(path:string,method:'GET'|'POST'|'PATCH'|'DELETE',
    body?:Record<string,unknown>):Promise<unknown> {
    const jwt=await this.token();
    if(typeof jwt!=='string'||!jwt.trim())throw new PrivateGoalsError('AUTH_EXPIRED');
    let response:Response;
    try{
      response=await this.http(this.origin+'/rest/v1/'+path,{
        method,headers:{apikey:this.key,Authorization:'Bearer '+jwt,Accept:'application/json',
          ...(body===undefined?{}:{'Content-Type':'application/json'}),
          ...(method==='GET'?{}:{Prefer:'return=representation'})},
        body:body===undefined?undefined:JSON.stringify(body),
        credentials:'omit',cache:'no-store',redirect:'error',
        signal:AbortSignal.timeout(10000)
      });
    }catch{throw new PrivateGoalsError('PROVIDER_UNAVAILABLE');}
    if(!response.ok){
      await response.body?.cancel().catch(()=>{});
      if(response.status===401)throw new PrivateGoalsError('AUTH_EXPIRED');
      if(response.status===403)throw new PrivateGoalsError('FORBIDDEN');
      if(response.status===409)throw new PrivateGoalsError('CONFLICT');
      throw new PrivateGoalsError('PROVIDER_UNAVAILABLE');
    }
    return responseJson(response);
  }
  private one<T>(raw:unknown,valid:(row:unknown)=>row is T):T {
    if(!Array.isArray(raw)||raw.length!==1||!valid(raw[0]))
      throw new PrivateGoalsError('INVALID_ACK');
    return raw[0];
  }
  private many<T>(raw:unknown,valid:(row:unknown)=>row is T):T[] {
    if(!Array.isArray(raw)||raw.length>100||raw.some(row=>!valid(row)))
      throw new PrivateGoalsError('INVALID_ACK');
    return raw;
  }
  /**
   * A dropped 201 response must not create a duplicate goal/progress/milestone.
   * Exact operation UUID collisions are resolved by reading the owner-RLS row;
   * mismatched payloads remain conflicts, never an optimistic success.
   */
  private async insertOrReplay<T>(
    table:'private_goals'|'private_goal_progress_events'|'private_goal_milestones',
    operationId:string,body:Record<string,unknown>,valid:(row:unknown)=>row is T
  ):Promise<{row:T;replayed:boolean}> {
    try{
      const row=this.one(await this.send(table+'?select=*','POST',body),valid);
      return {row,replayed:false};
    }catch(error){
      if(!(error instanceof PrivateGoalsError)||error.code!=='CONFLICT')throw error;
      const path=table+'?select=*&operation_id=eq.'+operationId+'&limit=2';
      const raw=await this.send(path,'GET');
      return {row:this.one(raw,valid),replayed:true};
    }
  }
  async createGoal(operationId:string,title:string,description='',
    targetValue:number|null=null,unit:string|null=null,dueOn:string|null=null):Promise<PrivateGoal>{
    if(!validId(operationId)||!validText(title,1,160)||
       !validText(description,0,2000)||
       (targetValue!==null&&(!numeric(targetValue)||targetValue<=0))||
       (unit!==null&&!validText(unit,1,32))||(dueOn!==null&&!date(dueOn)))
      throw new PrivateGoalsError('VALIDATION');
    operationId=operationId.toLowerCase();
    const {row,replayed}=await this.insertOrReplay('private_goals',operationId,{
      operation_id:operationId,title,description,target_value:targetValue,unit,due_on:dueOn
    },validGoal);
    if(row.operation_id!==operationId||row.title!==title||
       row.description!==description||row.target_value!==targetValue||
       row.unit!==unit||row.due_on!==dueOn||
       (!replayed&&row.status!=='ACTIVE'))
      throw new PrivateGoalsError(replayed?'CONFLICT':'INVALID_ACK');
    return row;
  }
  async listGoals():Promise<PrivateGoal[]> {
    return this.many(await this.send('private_goals?select=*&order=created_at.desc&limit=100','GET'),validGoal);
  }
  async updateGoal(id:string,fields:GoalUpdate):Promise<PrivateGoal> {
    if(!validId(id)||!object(fields)||!Object.keys(fields).length||
       Object.keys(fields).some(key=>!['title','description','target_value','unit','due_on','status'].includes(key))||
       (fields.title!==undefined&&!validText(fields.title,1,160))||
       (fields.description!==undefined&&!validText(fields.description,0,2000))||
       (fields.target_value!==undefined&&fields.target_value!==null&&
         (!numeric(fields.target_value)||fields.target_value<=0))||
       (fields.unit!==undefined&&fields.unit!==null&&!validText(fields.unit,1,32))||
       (fields.due_on!==undefined&&fields.due_on!==null&&!date(fields.due_on))||
       (fields.status!==undefined&&!goalStatuses.has(fields.status)))
      throw new PrivateGoalsError('VALIDATION');
    id=id.toLowerCase();
    const raw=await this.send('private_goals?id=eq.'+id+'&select=*','PATCH',fields);
    const result=this.one(raw,validGoal);
    if(result.id!==id||Object.entries(fields).some(([k,v])=>
      result[k as keyof PrivateGoal]!==v))throw new PrivateGoalsError('INVALID_ACK');
    return result;
  }
  async deleteGoal(id:string):Promise<string> {
    if(!validId(id))throw new PrivateGoalsError('VALIDATION');
    id=id.toLowerCase();
    const raw=await this.send('private_goals?id=eq.'+id+'&select=*','DELETE');
    const result=this.one(raw,validGoal);
    if(result.id!==id)throw new PrivateGoalsError('INVALID_ACK');
    return result.id;
  }
  async addProgress(goalId:string,operationId:string,value:number,note=''):Promise<GoalProgress>{
    if(!validId(goalId)||!validId(operationId)||!numeric(value)||!validText(note,0,500))
      throw new PrivateGoalsError('VALIDATION');
    goalId=goalId.toLowerCase();operationId=operationId.toLowerCase();
    const {row,replayed}=await this.insertOrReplay('private_goal_progress_events',operationId,{
      goal_id:goalId,operation_id:operationId,value,note
    },validProgress);
    if(row.goal_id!==goalId||row.operation_id!==operationId||
       row.value!==value||row.note!==note)
      throw new PrivateGoalsError(replayed?'CONFLICT':'INVALID_ACK');
    return row;
  }
  async listProgress(goalId:string):Promise<GoalProgress[]> {
    if(!validId(goalId))throw new PrivateGoalsError('VALIDATION');
    goalId=goalId.toLowerCase();
    const path='private_goal_progress_events?select=*&goal_id=eq.'+goalId+
      '&order=created_at.desc,id.desc&limit=100';
    const values=this.many(await this.send(path,'GET'),validProgress);
    if(values.some(value=>value.goal_id!==goalId))
      throw new PrivateGoalsError('INVALID_ACK');
    return values;
  }
  async addMilestone(goalId:string,operationId:string,title:string,
    dueOn:string|null=null):Promise<GoalMilestone>{
    if(!validId(goalId)||!validId(operationId)||!validText(title,1,160)||
       (dueOn!==null&&!date(dueOn)))throw new PrivateGoalsError('VALIDATION');
    goalId=goalId.toLowerCase();operationId=operationId.toLowerCase();
    const {row,replayed}=await this.insertOrReplay('private_goal_milestones',operationId,{
      goal_id:goalId,operation_id:operationId,title,due_on:dueOn
    },validMilestone);
    if(row.goal_id!==goalId||row.operation_id!==operationId||
       row.title!==title||row.due_on!==dueOn||(!replayed&&row.completed_at!==null))
      throw new PrivateGoalsError(replayed?'CONFLICT':'INVALID_ACK');
    return row;
  }
  async listMilestones(goalId:string):Promise<GoalMilestone[]> {
    if(!validId(goalId))throw new PrivateGoalsError('VALIDATION');
    goalId=goalId.toLowerCase();
    const path='private_goal_milestones?select=*&goal_id=eq.'+goalId+
      '&order=created_at.asc&limit=100';
    const values=this.many(await this.send(path,'GET'),validMilestone);
    if(values.some(value=>value.goal_id!==goalId))throw new PrivateGoalsError('INVALID_ACK');
    return values;
  }
  async updateMilestone(id:string,fields:Partial<Pick<GoalMilestone,
    'title'|'due_on'|'completed_at'>>):Promise<GoalMilestone>{
    if(!validId(id)||!object(fields)||!Object.keys(fields).length||
       Object.keys(fields).some(k=>!['title','due_on','completed_at'].includes(k))||
       (fields.title!==undefined&&!validText(fields.title,1,160))||
       (fields.due_on!==undefined&&fields.due_on!==null&&!date(fields.due_on))||
       (fields.completed_at!==undefined&&fields.completed_at!==null&&
         !timestamp(fields.completed_at)))
      throw new PrivateGoalsError('VALIDATION');
    id=id.toLowerCase();
    const raw=await this.send('private_goal_milestones?id=eq.'+id+'&select=*','PATCH',fields);
    const result=this.one(raw,validMilestone);
    if(result.id!==id||Object.entries(fields).some(([k,v])=>
      result[k as keyof GoalMilestone]!==v))throw new PrivateGoalsError('INVALID_ACK');
    return result;
  }
  async deleteMilestone(id:string):Promise<string> {
    if(!validId(id))throw new PrivateGoalsError('VALIDATION');
    id=id.toLowerCase();
    const raw=await this.send('private_goal_milestones?id=eq.'+id+'&select=*','DELETE');
    const result=this.one(raw,validMilestone);
    if(result.id!==id)throw new PrivateGoalsError('INVALID_ACK');
    return id;
  }
}
