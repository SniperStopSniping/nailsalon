'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createRequire } = require('node:module');
const path = require('node:path');
const PHASES = Object.freeze(['BEGIN','COMMIT','ROLLBACK','IDENTITY_LOCK','CLIENT_IDENTITY_LOOKUP','CLIENT_INSERT','ACTIVE_APPOINTMENTS','AVAILABILITY','APPOINTMENT_INSERT','INTENT_WRITE','OPERATION_LINK','OTHER']);
const RELATIONS = new Set(['salon_client','salon_client_contact_alias','appointment','customer_booking_operation','public_booking_attempt','communication_intent']);
const RELATION_NAMES = [...RELATIONS];
const LOCK_TYPES = ['relation','page','tuple'];
const INDEXES = new Set(['salon_client_pkey','salon_client_salon_phone_idx','salon_client_phone_idx','salon_client_salon_idx','salon_client_salon_id_id_idx','salon_client_contact_alias_unique','salon_client_contact_alias_client_idx']);
const NODE_TYPES = new Set(['Seq Scan','Index Scan','Index Only Scan','Bitmap Heap Scan','Bitmap Index Scan','BitmapOr','BitmapAnd','Unique','Sort','Aggregate','HashAggregate','Append','Result','Subquery Scan','Hash','Hash Join','Nested Loop','Gather','Gather Merge']);
function fail(code) { throw Object.assign(new Error(code),{code}); }
function classify(text) {
 const q=String(text).replaceAll('"','').replace(/\s+/g,' ').trim().toLowerCase();
 if (/^begin\b/.test(q)) return 'BEGIN'; if (/^commit\b/.test(q)) return 'COMMIT'; if (/^rollback\b/.test(q)) return 'ROLLBACK';
 if (q.includes('pg_advisory_xact_lock')) return 'IDENTITY_LOCK';
 if (q.includes('select distinct candidate.id') && q.includes('from salon_client as client') && q.includes('from salon_client_contact_alias as alias')) return 'CLIENT_IDENTITY_LOOKUP';
 if (/^insert into salon_client\b/.test(q)) return 'CLIENT_INSERT';
 if (/^insert into appointment\b/.test(q)) return 'APPOINTMENT_INSERT';
 if (/^(?:insert into|update) communication_intent\b/.test(q)) return 'INTENT_WRITE';
 if (/^update (?:customer_booking_operation|public_booking_attempt)\b/.test(q)) return 'OPERATION_LINK';
 if (q.includes('from appointment') && q.includes('regexp_replace')) return 'ACTIVE_APPOINTMENTS';
 if (q.includes('from appointment')) return 'AVAILABILITY';
 return 'OTHER';
}
function state(error) { for(let i=0;error && i<8;i++,error=error.cause)if(['40001','40P01'].includes(error.code))return error.code;return 'OTHER'; }
function planSafe(node, depth=0, budget={nodes:0}) {
 if (!node || depth>12 || ++budget.nodes>64 || typeof node!=='object') fail('SSI_PLAN_SHAPE');
 const out={};if(NODE_TYPES.has(node['Node Type']))out.nodeType=node['Node Type'];else out.nodeType='OTHER';
 if(RELATIONS.has(node['Relation Name']))out.relation=node['Relation Name'];
 if(INDEXES.has(node['Index Name']))out.index=node['Index Name'];
 for(const [from,to] of [['Startup Cost','startupCost'],['Total Cost','totalCost'],['Plan Rows','rows']])if(typeof node[from]==='number' && Number.isFinite(node[from]) && node[from]>=0 && node[from]<=1e15)out[to]=node[from];
 if(Array.isArray(node.Plans)){if(node.Plans.length>16)fail('SSI_PLAN_CHILD_BOUND');out.children=node.Plans.map(child=>planSafe(child,depth+1,budget));}
 return out;
}
// One own-backend metadata statement; no customer row or expression is read.
const LOCK_QUERY = "WITH owned AS (SELECT c.relname AS relation,l.locktype,l.page::bigint,l.tuple::int FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation WHERE l.pid=pg_backend_pid() AND l.mode='SIReadLock') SELECT pg_backend_pid()::int AS backend,(SELECT count(*)::int FROM owned) AS total,(SELECT coalesce(json_agg(g),'[]'::json) FROM (SELECT relation,locktype,count(*)::int AS count FROM owned GROUP BY relation,locktype ORDER BY relation,locktype) g) AS groups,(SELECT coalesce(json_agg(i),'[]'::json) FROM (SELECT relation,locktype,page,tuple FROM owned ORDER BY relation,locktype,page,tuple LIMIT 8) i) AS identities";
function locksSafe(rows, backend) {
 if(!Number.isInteger(backend)||backend<=1||backend>2147483647||!Array.isArray(rows)||rows.length!==1||rows[0].backend!==backend)fail('SSI_LOCK_SHAPE');
 const row=rows[0];if(!Number.isInteger(row.total)||row.total<0||row.total>1179630||!Array.isArray(row.groups)||row.groups.length>128||!Array.isArray(row.identities)||row.identities.length>8)fail('SSI_LOCK_SHAPE');
 const counts=Array(18).fill(0);let excluded=0,groupTotal=0;
 for(const group of row.groups){if(!Number.isInteger(group.count)||group.count<1||group.count>65535)fail('SSI_LOCK_COUNT');const relation=RELATION_NAMES.indexOf(group.relation),type=LOCK_TYPES.indexOf(group.locktype);groupTotal+=group.count;if(relation>=0&&type>=0){const at=relation*3+type;if(counts[at])fail('SSI_LOCK_DUPLICATE');counts[at]=group.count;}else excluded+=group.count;}
 if(groupTotal!==row.total||excluded>65535)fail('SSI_LOCK_TOTAL');
 const identities=row.identities.flatMap(lock=>{const relation=RELATION_NAMES.indexOf(lock.relation),type=LOCK_TYPES.indexOf(lock.locktype);if(relation<0||type<0)return [];if(![lock.page,lock.tuple].every(x=>x===null||Number.isInteger(x)&&x>=0)||lock.page>4294967295||lock.tuple>65535)fail('SSI_LOCK_IDENTITY');return [[relation,type,lock.page,lock.tuple]];});
 return [backend,row.total,excluded,counts,identities,row.total-identities.length];
}
function compactReport(report){
 const first=report.attempts.filter(row=>row.run<=25);if(first.some(row=>!Number.isFinite(row.elapsedMs)||row.elapsedMs<0||row.elapsedMs>1200000))fail('SSI_ATTEMPT_ELAPSED_BOUND');if(first.length>200)fail('SSI_FIRST_WAVE_BOUND');
 const outcomes=['COMPLETED','40001','40P01','OTHER'];const states=[null,'40001','40P01','OTHER'];
 const later={omitted:0,outcomes:Array(4).fill(0),failurePhases:Array(PHASES.length).fill(0)};
 for(const row of report.attempts.filter(row=>row.run>25)){later.omitted++;later.outcomes[outcomes.indexOf(row.outcome)]++;if(row.failurePhase!==null)later.failurePhases[PHASES.indexOf(row.failurePhase)]++;}
 const nodes=[];let planTruncated=false;
 function flatten(node,depth=0){if(nodes.length>=16){planTruncated=true;return;}nodes.push([depth,node.nodeType==='OTHER'?NODE_TYPES.size:[...NODE_TYPES].indexOf(node.nodeType),RELATION_NAMES.indexOf(node.relation),[...INDEXES].indexOf(node.index),node.startupCost??null,node.totalCost??null,node.rows??null]);for(const child of node.children??[])flatten(child,depth+1);}
 for(const plan of report.plans)flatten(plan);
 const value={schemaVersion:2,workloadPerturbed:true,rawSqlOrParametersRetained:false,runs:report.runs,phaseCounts:PHASES.map(phase=>report.queryPhaseCounts[phase]),firstWaveAttempts:first.map(row=>[row.run,row.attempt,Math.round(row.elapsedMs),row.failurePhase===null?-1:PHASES.indexOf(row.failurePhase),outcomes.indexOf(row.outcome)*4+states.indexOf(row.sqlstate)]),laterAttempts:later,plan:{nodes,truncated:planTruncated},lockSnapshots:JSON.parse(JSON.stringify(report.lockSnapshots)),barrier:[report.barrier.target,report.barrier.arrivals,+report.barrier.released,+report.barrier.timedOut,report.barrier.timeoutMs],outputOmittedIdentities:0};
 // Keep all first-wave attempt rows and group counts; shed only optional identities.
 while(Buffer.byteLength(JSON.stringify(value))>12288){let row=value.lockSnapshots.find(row=>row[4].length);if(!row)fail('SSI_COMPACT_BUDGET');row[4].pop();row[5]++;value.outputOmittedIdentities++;}
 return value;
}
function createMeter({clock=()=>performance.now(),sleepTimer=setTimeout,clearTimer=clearTimeout,target=25,barrierMs=2500}={}) {
 const als=new AsyncLocalStorage();let nextRun=0;let snapshotTaken=false;
 const report={schemaVersion:1,workloadPerturbed:true,rawSqlOrParametersRetained:false,runs:0,queryPhaseCounts:Object.fromEntries(PHASES.map(p=>[p,0])),attempts:[],plans:[],lockSnapshots:[],barrier:{target,arrivals:0,released:false,timedOut:false,timeoutMs:barrierMs}};
 let release;const ready=new Promise(resolve=>{release=resolve;});let timer;const seen=new Set();
 function close(timedOut){if(report.barrier.released)return;report.barrier.released=true;report.barrier.timedOut=timedOut;if(timer)clearTimer(timer);release();}
 const api={
  startRun(){if(++nextRun>128)fail('SSI_RUN_BOUND');report.runs=nextRun;return nextRun;},
  async attempt(run,attempt,work){if(!Number.isInteger(run)||attempt<1||attempt>8)fail('SSI_ATTEMPT_SHAPE');const store={run,attempt,started:clock(),failure:null};return als.run(store,async()=>{let outcome='COMPLETED';try{return await work();}catch(error){outcome=state(error);throw error;}finally{if(report.attempts.length>=1024)fail('SSI_ATTEMPT_BOUND');report.attempts.push({run,attempt,elapsedMs:Math.round((clock()-store.started)*10)/10,outcome,failurePhase:store.failure?.phase??null,sqlstate:store.failure?.sqlstate??null});}});},
  install(Client){const original=Client.prototype.query;Client.prototype.query=function(...args){const store=als.getStore();if(!store)return original.apply(this,args);if(args.some(x=>typeof x==='function'))fail('SSI_CALLBACK_QUERY_UNSUPPORTED');const text=typeof args[0]==='string'?args[0]:args[0]?.text;const values=Array.isArray(args[1])?args[1]:args[0]?.values;const phase=classify(text);report.queryPhaseCounts[phase]++;const backend=this;let pending;try{pending=original.apply(this,args);}catch(error){store.failure??={phase,sqlstate:state(error)};throw error;}return Promise.resolve(pending).then(async result=>{
    if(phase==='CLIENT_IDENTITY_LOOKUP'&&store.attempt===1&&!report.barrier.released&&!seen.has(store.run)){
     // Real canonical new-phone branch only: source passes email NULL and no matching client.
     if(!Array.isArray(values)||values.length!==10||!/^scale-25-0-[a-f0-9]{12}-[0-9]+$/.test(values[0])||values[5]!==values[0]||typeof values[1]!=='string'||!/^\d{10}$/.test(values[1])||![2,6,7].every(i=>values[i]===values[1])||![3,4,8,9].every(i=>values[i]===null)||result.rows.length!==0)fail('SSI_NEW_PHONE_PRECONDITION');
     seen.add(store.run);
     if(!timer)timer=sleepTimer(()=>close(true),barrierMs);
     if(!snapshotTaken){snapshotTaken=true;const plan=await original.call(backend,{text:'EXPLAIN (FORMAT JSON) '+text,values});report.plans.push(planSafe(plan.rows[0]['QUERY PLAN'][0].Plan));}
     const locks=await original.call(backend,{text:LOCK_QUERY});
     report.lockSnapshots.push(locksSafe(locks.rows,backend.processID));
     if(++report.barrier.arrivals===target)close(false);
     await ready;if(report.barrier.timedOut)fail('SSI_BARRIER_TIMEOUT');
    }
    return result;
   },error=>{store.failure??={phase,sqlstate:state(error)};throw error;});};return()=>{Client.prototype.query=original;};},
  report(){return compactReport(report);}, close(){close(true);}
 };return api;
}
module.exports={createMeter,classify,state,planSafe,locksSafe,compactReport,PHASES,RELATION_NAMES,LOCK_TYPES,NODE_TYPES,INDEXES,LOCK_QUERY};
if(process.env.SSI_DIAGNOSTIC_ENABLE==='1'){
 const root=process.env.SSI_RUNTIME_COPY;if(!root||!path.isAbsolute(root))fail('SSI_RUNTIME_REQUIRED');
 const meter=createMeter();meter.install(createRequire(path.join(root,'package.json'))('pg').Client);globalThis.__LUSTER_SSI_DIAGNOSTIC__=meter;

}
