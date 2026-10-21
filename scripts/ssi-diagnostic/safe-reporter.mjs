export default class SafeReporter {
 onUserConsoleLog(log){
  for(const line of log.content.split('\n').flatMap(part=>part.split('\\n'))){
   if(/^SCALE_BOOKING salons=25 round=1 initial_201=\d+ initial_503=\d+ recovery_waves=\d+ recovery_attempts=\d+ first_wave_ms=[\d.]+ total_ms=[\d.]+$/.test(line)||line==='SSI_DIAGNOSTIC_SELECTED_EXECUTED=1 SSI_DIAGNOSTIC_SELECTED_SKIPPED=0 ORIGINAL_UNSELECTED=59')process.stdout.write(line+'\n');
   else if(line.startsWith('SSI_DRIVER_REPORT=')&&Buffer.byteLength(line)<=12306){try{const report=JSON.parse(line.slice(18));if(report.schemaVersion===2&&report.rawSqlOrParametersRetained===false&&report.workloadPerturbed===true)process.stdout.write('SSI_DRIVER_REPORT='+JSON.stringify(report)+'\n');}catch{}}
  }
 }
 onTestRunEnd(modules,errors,reason){
  const counters={passed:0,failed:0,skipped:0,other:0,unhandledErrors:errors.length,completed:reason==='passed'};
  for(const module of modules)for(const test of module.children.allTests()){
   const state=test.result().state;
   if(state==='passed')counters.passed++;else if(state==='failed')counters.failed++;else if(state==='skipped')counters.skipped++;else counters.other++;
  }
  process.stdout.write('SSI_TEST_RESULT='+JSON.stringify(counters)+'\n');
 }
}
