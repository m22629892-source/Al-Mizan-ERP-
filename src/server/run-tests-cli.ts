import { runAllFinancialTests } from './tests.js';

console.log('====================================================');
console.log('🚀 Running Al-Mizan ERP Financial Acceptance Test Suite');
console.log('====================================================');

const startTime = Date.now();
const { summary, results } = runAllFinancialTests();
const totalDuration = Date.now() - startTime;

results.forEach(res => {
  const icon = res.passed ? '✅' : '❌';
  console.log(`${icon} [Suite ${res.suiteNumber}] ${res.name}: ${res.passed ? 'PASSED' : 'FAILED'} (${res.durationMs}ms)`);
  if (!res.passed) {
    console.error(`   Error details: ${res.message}`);
  }
});

console.log('====================================================');
console.log(`📊 Test Summary: Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed} | Time: ${totalDuration}ms`);
console.log('====================================================');

if (summary.failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
