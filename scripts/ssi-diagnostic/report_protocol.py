"""Pinned compact v2 protocol; numeric metadata only."""
import json,re
def require(value,code):
 if not value:raise RuntimeError(code)

def validate_driver(value):
 require(set(value)=={'schemaVersion','workloadPerturbed','rawSqlOrParametersRetained','runs','phaseCounts','firstWaveAttempts','laterAttempts','plan','lockSnapshots','barrier','outputOmittedIdentities'},'SSI_DRIVER_FIELDS')
 def integer(x,lo,hi):return type(x) is int and lo<=x<=hi
 require(value['schemaVersion']==2 and value['workloadPerturbed'] is True and value['rawSqlOrParametersRetained'] is False and integer(value['runs'],1,128),'SSI_DRIVER_SCHEMA')
 require(len(json.dumps(value,separators=(',',':')).encode())<=12288,'SSI_DRIVER_BYTE_BOUND')
 require(isinstance(value['phaseCounts'],list) and len(value['phaseCounts'])==12 and all(integer(x,0,1000000) for x in value['phaseCounts']),'SSI_PHASE_COUNTS')
 require(isinstance(value['firstWaveAttempts'],list) and len(value['firstWaveAttempts'])<=200,'SSI_ATTEMPT_BOUND')
 seen=set()
 for row in value['firstWaveAttempts']:
  require(isinstance(row,list) and len(row)==5 and integer(row[0],1,25) and integer(row[1],1,8) and integer(row[2],0,1200000) and integer(row[3],-1,11) and integer(row[4],0,15) and tuple(row[:2]) not in seen,'SSI_ATTEMPT_FIELDS');seen.add(tuple(row[:2]))
 later=value['laterAttempts'];require(set(later)=={'omitted','outcomes','failurePhases'} and integer(later['omitted'],0,1024) and len(later['outcomes'])==4 and len(later['failurePhases'])==12 and all(integer(x,0,1024) for x in later['outcomes']+later['failurePhases']) and sum(later['outcomes'])==later['omitted'],'SSI_LATER_FIELDS')
 plan=value['plan'];require(set(plan)=={'nodes','truncated'} and type(plan['truncated']) is bool and isinstance(plan['nodes'],list) and len(plan['nodes'])<=16,'SSI_PLAN_FIELDS')
 for row in plan['nodes']:
  require(isinstance(row,list) and len(row)==7 and integer(row[0],0,12) and integer(row[1],0,20) and integer(row[2],-1,5) and integer(row[3],-1,6) and all(x is None or type(x) in [int,float] and 0<=x<=1e15 for x in row[4:]),'SSI_PLAN_VALUES')
 require(isinstance(value['lockSnapshots'],list) and len(value['lockSnapshots'])<=25,'SSI_LOCK_BOUND')
 for row in value['lockSnapshots']:
  require(isinstance(row,list) and len(row)==6 and integer(row[0],2,2147483647) and integer(row[1],0,1179630) and integer(row[2],0,65535) and isinstance(row[3],list) and len(row[3])==18 and all(integer(x,0,65535) for x in row[3]) and sum(row[3])+row[2]==row[1] and isinstance(row[4],list) and len(row[4])<=8 and integer(row[5],0,1179630) and row[5]==row[1]-len(row[4]),'SSI_LOCK_FIELDS')
  for lock in row[4]:require(isinstance(lock,list) and len(lock)==4 and integer(lock[0],0,5) and integer(lock[1],0,2) and (lock[2] is None or integer(lock[2],0,4294967295)) and (lock[3] is None or integer(lock[3],0,65535)),'SSI_LOCK_IDENTITIES')
 barrier=value['barrier'];require(isinstance(barrier,list) and len(barrier)==5 and barrier[0]==25 and integer(barrier[1],0,25) and barrier[2] in [0,1] and barrier[3] in [0,1] and barrier[4]==2500,'SSI_BARRIER_FIELDS')
 require(integer(value['outputOmittedIdentities'],0,200),'SSI_IDENTITY_OMISSION')

def partial_driver(raw):
 require(len(raw)<=16384,'SSI_OUTPUT_BOUND')
 values=[]
 for match in re.finditer(r'SSI_DRIVER_REPORT=(\{[^\n]*\})',raw.decode('utf8','replace')):
  value=json.loads(match.group(1));validate_driver(value)
  require(value['schemaVersion']==2 and value['rawSqlOrParametersRetained'] is False and value['workloadPerturbed'] is True and len(value['firstWaveAttempts'])<=200 and len(value['plan']['nodes'])<=16 and len(value['lockSnapshots'])<=25,'SSI_PARTIAL_REPORT_BOUND');values.append(value)
 require(len(values)==1,'SSI_PARTIAL_REPORT_MISSING');return {'driver':values[0],'integrityAssertionsPassed':False,'partialOnly':True}

def safe_output(raw):
 require(len(raw)<=16384,'SSI_OUTPUT_BOUND')
 text=raw.decode('utf8','replace');rows=[]
 for match in re.finditer(r'SSI_DRIVER_REPORT=(\{[^\n]*\})',text):
  value=json.loads(match.group(1));validate_driver(value);require(value['schemaVersion']==2 and value['rawSqlOrParametersRetained'] is False and value['workloadPerturbed'] is True,'SSI_REPORT_SCHEMA');require(len(value['firstWaveAttempts'])<=200 and 1<=len(value['plan']['nodes'])<=16 and len(value['lockSnapshots'])==25,'SSI_REPORT_BOUNDS');rows.append(value)
 require(len(rows)==1,'SSI_ACTUAL_WORKER_REPORT_REQUIRED');diag=rows[0]
 require(diag['barrier']==[25,25,1,0,2500],'SSI_ACTUAL_CANONICAL_BARRIER_REQUIRED')
 require(diag['phaseCounts'][4]>=25 and diag['phaseCounts'][5]>=25 and diag['phaseCounts'][8]>=25,'SSI_CANONICAL_QUERY_COVERAGE_REQUIRED')
 matches=re.findall(r'SSI_TEST_RESULT=(\{[^\n]*\})',text);require(len(matches)==1,'SSI_TEST_ACCOUNTING_REQUIRED');tests=json.loads(matches[0]);require(tests=={'passed':1,'failed':0,'skipped':59,'other':0,'unhandledErrors':0,'completed':True},'SSI_TEST_INTEGRITY_REQUIRED')
 require(text.count('SSI_DIAGNOSTIC_SELECTED_EXECUTED=1 SSI_DIAGNOSTIC_SELECTED_SKIPPED=0 ORIGINAL_UNSELECTED=59')==1,'SSI_SELECTED_CASE_REQUIRED')
 matches=re.findall(r'SCALE_BOOKING salons=25 round=1 initial_201=(\d+) initial_503=(\d+) recovery_waves=(\d+) recovery_attempts=(\d+) first_wave_ms=([\d.]+) total_ms=([\d.]+)',text);require(len(matches)==1,'SSI_ONE_ROUND_REQUIRED')
 values=matches[0];require(int(values[0])+int(values[1])==25,'SSI_FIRST_WAVE_ACCOUNTING')
 return {'driver':diag,'tests':tests,'round':dict(zip(['initial201','initial503','recoveryWaves','recoveryAttempts','firstWaveMs','totalMs'],[int(v) if i<4 else float(v) for i,v in enumerate(values)]))}

