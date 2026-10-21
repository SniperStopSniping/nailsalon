"""Exact, explicit instrumentation of copied source only; never candidate edits."""
HELPER='src/libs/clientLifecycleStabilization.ts'
TEST='src/libs/appointmentCreation.customerOperation.concurrency.integration.test.ts'

def one(text,old,new):
 if text.count(old)!=1:raise RuntimeError('SSI_PATCH_PREIMAGE_DRIFT')
 return text.replace(old,new)

def transform(helper,test):
 helper=one(helper,'  const maxAttempts = policy?.maxAttempts ?? 3;', '''  const diagnostic = (globalThis as unknown as { __LUSTER_SSI_DIAGNOSTIC__?: {
    startRun(): number;
    attempt<T>(run: number, attempt: number, work: () => Promise<T>): Promise<T>;
  } }).__LUSTER_SSI_DIAGNOSTIC__;
  if (policy === BOOKING_TRANSACTION_RETRY_POLICY && !diagnostic) throw new Error('SSI_DIAGNOSTIC_PRELOAD_REQUIRED');
  const diagnosticRun = policy === BOOKING_TRANSACTION_RETRY_POLICY ? diagnostic!.startRun() : null;
  const maxAttempts = policy?.maxAttempts ?? 3;''')
 helper=one(helper,'      return await operation(attempt);', '''      return await (diagnosticRun === null ? operation(attempt) : diagnostic!.attempt(diagnosticRun, attempt, () => operation(attempt)));''')
 test=one(test,"it.each([5, 10, 25])('completes five fresh rounds", "it.each([25])('completes five fresh rounds")
 test=one(test,'for (let round = 0; round < 5; round += 1)', 'for (let round = 0; round < 1; round += 1)')
 test=one(test,'    await pool?.end();', '''    await pool?.end();
    const diagnosticReport = (globalThis as unknown as { __LUSTER_SSI_DIAGNOSTIC__: { report(): unknown } }).__LUSTER_SSI_DIAGNOSTIC__.report();
    process.stdout.write('SSI_DRIVER_REPORT=' + JSON.stringify(diagnosticReport) + '\\n');''')
 test=one(test,'expect(executed).toBe(62);','expect(executed).toBe(1);')
 test=one(test,'CUSTOMER_CREATOR_POSTGRES_TESTS_EXECUTED=${executed} CUSTOMER_CREATOR_POSTGRES_TESTS_SKIPPED=0','SSI_DIAGNOSTIC_SELECTED_EXECUTED=${executed} SSI_DIAGNOSTIC_SELECTED_SKIPPED=0 ORIGINAL_UNSELECTED=59')
 return {HELPER:helper,TEST:test}
