/**
 * scripts/patch-monitor.test.js
 *
 * Automated test suite for the Upptime retry threshold patcher.
 * Tests regex accuracy, idempotency, edge cases, and runtime execution logic.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { patchFile, PATCH_START_MARKER } = require("./patch-monitor");

console.log("Running Upptime Retry Threshold Patcher Tests...\n");

// Sample representation of the hardcoded block in Upptime v1.46.5 dist/index.js
const SAMPLE_ORIGINAL_BLOCK = `
        const performTestOnce = async () => ({ result: { httpCode: 500 }, responseTime: 120, status: "down" });
        let { result, responseTime, status } = await performTestOnce();
        if (status === "down" || status === "degraded") {
            console.log(\`Site \${site.name} appears \${status} (HTTP \${result.httpCode}), retrying after 2s...\`);
            await wait(2000);
            const secondTry = await performTestOnce();
            if (secondTry.status === "up") {
                console.log(\`Site \${site.name} recovered on second attempt\`);
                result = secondTry.result;
                responseTime = secondTry.responseTime;
                status = secondTry.status;
            }
            else {
                console.log(\`Site \${site.name} still \${secondTry.status} on second attempt (HTTP \${secondTry.result.httpCode}), retrying after 10s...\`);
                await wait(10000);
                const thirdTry = await performTestOnce();
                if (thirdTry.status === "up") {
                    console.log(\`Site \${site.name} recovered on third attempt\`);
                    result = thirdTry.result;
                    responseTime = thirdTry.responseTime;
                    status = thirdTry.status;
                }
                else {
                    console.log(\`Site \${site.name} confirmed \${thirdTry.status} after 3 attempts (HTTP \${thirdTry.result.httpCode})\`);
                    // Use the last attempt's result as it's the most recent
                    result = thirdTry.result;
                    responseTime = thirdTry.responseTime;
                    status = thirdTry.status;
                }
            }
        }
`;

const tempDir = path.join(__dirname, "..", ".tmp_test");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const tempFile = path.join(tempDir, "mock-dist-index.js");

try {
  // Test 1: Patching an unpatched file
  console.log("Test 1: Patching original hardcoded bundle");
  fs.writeFileSync(tempFile, SAMPLE_ORIGINAL_BLOCK, "utf8");
  const result1 = patchFile(tempFile);
  assert.strictEqual(result1.success, true, "Patch should succeed on original block");
  const patchedContent = fs.readFileSync(tempFile, "utf8");
  assert.ok(patchedContent.includes(PATCH_START_MARKER), "Patched content should contain start marker");
  assert.ok(patchedContent.includes("configuredRetries"), "Patched content should include configuredRetries logic");
  assert.ok(!patchedContent.includes("retrying after 2s..."), "Patched content must NOT contain hardcoded 2s retry");
  console.log("✓ Test 1 passed\n");

  // Test 2: Idempotency (running patch on already-patched file)
  console.log("Test 2: Idempotency verification");
  const result2 = patchFile(tempFile);
  assert.strictEqual(result2.success, true, "Patching already patched file should return success");
  assert.ok(result2.reason.includes("Already patched"), "Reason should indicate already patched");
  const recheckedContent = fs.readFileSync(tempFile, "utf8");
  assert.strictEqual(patchedContent, recheckedContent, "File content should remain unchanged on second run");
  console.log("✓ Test 2 passed\n");

  // Test 3: Unmatched file handling
  console.log("Test 3: Unmatched file error handling");
  const nonMatchingFile = path.join(tempDir, "unmatched.js");
  fs.writeFileSync(nonMatchingFile, "console.log('completely unrelated code');", "utf8");
  const result3 = patchFile(nonMatchingFile);
  assert.strictEqual(result3.success, false, "Should fail safely if hardcoded block not found");
  console.log("✓ Test 3 passed\n");

  // Test 4: Runtime behavior simulation
  console.log("Test 4: Simulating runtime logic with various per-site configs");

  async function simulateRun(siteConfig, mockResponses) {
    let callCount = 0;
    const waitCalls = [];
    const wait = async (ms) => waitCalls.push(ms);
    const performTestOnce = async () => {
      const resp = mockResponses[callCount] || mockResponses[mockResponses.length - 1];
      callCount++;
      return resp;
    };

    const site = siteConfig;
    let { result, responseTime, status } = await performTestOnce();

    // Injected patch logic execution:
    const configuredRetries = Number.isInteger(site.retries) ? site.retries : 1;
    const configuredDelay = Number.isInteger(site.retryDelay) ? site.retryDelay : 3000;
    if ((status === "down" || status === "degraded") && configuredRetries > 1) {
      for (let attempt = 2; attempt <= configuredRetries; attempt++) {
        await wait(configuredDelay);
        const retryTry = await performTestOnce();
        if (retryTry.status === "up") {
          result = retryTry.result;
          responseTime = retryTry.responseTime;
          status = retryTry.status;
          break;
        } else {
          result = retryTry.result;
          responseTime = retryTry.responseTime;
          status = retryTry.status;
        }
      }
    }

    return { status, callCount, waitCalls };
  }

  (async () => {
    // 4a: Site WITHOUT retries config -> fails immediately (1 call, 0 waits)
    const runA = await simulateRun(
      { name: "Unconfigured Site" },
      [{ status: "down", result: { httpCode: 500 }, responseTime: 100 }]
    );
    assert.strictEqual(runA.status, "down");
    assert.strictEqual(runA.callCount, 1, "Should only check once if retries is not set");
    assert.strictEqual(runA.waitCalls.length, 0, "Should not wait if retries is not set");
    console.log("  ✓ 4a: Unconfigured site fails immediately without retrying");

    // 4b: Site WITH retries: 3 and retryDelay: 5000 -> recovers on attempt 2
    const runB = await simulateRun(
      { name: "Flapping Site", retries: 3, retryDelay: 5000 },
      [
        { status: "down", result: { httpCode: 502 }, responseTime: 100 },
        { status: "up", result: { httpCode: 200 }, responseTime: 80 }
      ]
    );
    assert.strictEqual(runB.status, "up");
    assert.strictEqual(runB.callCount, 2, "Should stop after successful retry");
    assert.deepStrictEqual(runB.waitCalls, [5000], "Should wait configured 5000ms");
    console.log("  ✓ 4b: Recovers on second attempt with configured delay");

    // 4c: Site WITH retries: 3 -> fails all attempts -> confirmed down
    const runC = await simulateRun(
      { name: "Dead Site", retries: 3, retryDelay: 2000 },
      [
        { status: "down", result: { httpCode: 503 }, responseTime: 100 },
        { status: "down", result: { httpCode: 503 }, responseTime: 100 },
        { status: "down", result: { httpCode: 503 }, responseTime: 100 }
      ]
    );
    assert.strictEqual(runC.status, "down");
    assert.strictEqual(runC.callCount, 3, "Should exhaust all 3 attempts");
    assert.deepStrictEqual(runC.waitCalls, [2000, 2000], "Should wait twice");
    console.log("  ✓ 4c: Confirmed down after exhausting all retries");

    console.log("\nAll tests passed successfully!");
  })();

} finally {
  // Cleanup test directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {}
}
