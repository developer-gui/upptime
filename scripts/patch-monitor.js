/**
 * scripts/patch-monitor.js
 *
 * Dynamically patches Upptime's bundled action (upptime/uptime-monitor@v1.46.5)
 * inside the GitHub Actions runner before the check step executes.
 *
 * Replaces the hardcoded 3-try (2s, 10s) retry sequence with a dynamic,
 * per-site retry threshold loop based on `site.retries` and `site.retryDelay`
 * from .upptimerc.yml (mirroring Uptime Kuma's flap damping capability).
 */

const fs = require("fs");
const path = require("path");

const PATCH_START_MARKER = "// [UPPTIME-RETRY-PATCH-START]";
const PATCH_END_MARKER = "// [UPPTIME-RETRY-PATCH-END]";

// The replacement logic injected into Upptime's performTestOnce execution block
const REPLACEMENT_BLOCK = `${PATCH_START_MARKER}
        const configuredRetries = Number.isInteger(site.retries) ? site.retries : 1;
        const configuredDelay = Number.isInteger(site.retryDelay) ? site.retryDelay : 3000;
        if ((status === "down" || status === "degraded") && configuredRetries > 1) {
            for (let attempt = 2; attempt <= configuredRetries; attempt++) {
                console.log(\`Site \${site.name} appears \${status} (HTTP \${result.httpCode}), retrying attempt \${attempt}/\${configuredRetries} after \${configuredDelay}ms...\`);
                await wait(configuredDelay);
                const retryTry = await performTestOnce();
                if (retryTry.status === "up") {
                    console.log(\`Site \${site.name} recovered on attempt \${attempt}\`);
                    result = retryTry.result;
                    responseTime = retryTry.responseTime;
                    status = retryTry.status;
                    break;
                } else {
                    console.log(\`Site \${site.name} still \${retryTry.status} on attempt \${attempt} (HTTP \${retryTry.result.httpCode})\`);
                    result = retryTry.result;
                    responseTime = retryTry.responseTime;
                    status = retryTry.status;
                }
            }
            if (status !== "up") {
                console.log(\`Site \${site.name} confirmed \${status} after \${configuredRetries} attempts (HTTP \${result.httpCode})\`);
            }
        }
        ${PATCH_END_MARKER}`;

/**
 * Searches for all dist/index.js files inside Upptime's action directories.
 */
function findActionIndexFiles(rootDir) {
  const matches = [];
  if (!fs.existsSync(rootDir)) {
    return matches;
  }

  function walk(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          // Optimization: skip irrelevant node_modules or large folders
          if (entry.name !== "node_modules" && entry.name !== ".git") {
            walk(fullPath);
          }
        } else if (
          entry.isFile() &&
          entry.name === "index.js" &&
          (fullPath.includes("uptime-monitor") || fullPath.includes("_actions"))
        ) {
          matches.push(fullPath);
        }
      }
    } catch (err) {
      // Permission or reading error; skip directory
    }
  }

  walk(rootDir);
  return matches;
}

/**
 * Applies the retry threshold patch to a given target index.js file.
 * Returns { success: boolean, reason: string }
 */
function patchFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return { success: false, reason: `File not found: ${filePath}` };
  }

  const content = fs.readFileSync(filePath, "utf8");

  // Check if already patched
  if (content.includes(PATCH_START_MARKER)) {
    return { success: true, reason: "Already patched (idempotent)" };
  }

  // Regex matching Upptime's hardcoded retry block
  const targetPattern = /if\s*\(\s*status\s*===\s*["']down["']\s*\|\|\s*status\s*===\s*["']degraded["']\s*\)\s*\{[\s\S]*?console\.log\(`Site \$\{site\.name\} appears \$\{status\}[\s\S]*?status\s*=\s*thirdTry\.status;\s*\}\s*\}\s*\}/;

  if (!targetPattern.test(content)) {
    return {
      success: false,
      reason: "Could not find expected hardcoded retry sequence in target file",
    };
  }

  const patchedContent = content.replace(targetPattern, REPLACEMENT_BLOCK);
  fs.writeFileSync(filePath, patchedContent, "utf8");

  return { success: true, reason: "Successfully patched with configurable retry thresholds" };
}

function run() {
  console.log("=== Upptime Multi-Stage Retry Threshold Patcher ===");

  // 1. If explicit file path is passed as command line argument
  const targetArg = process.argv[2];
  if (targetArg) {
    console.log(`Target path explicitly provided: ${targetArg}`);
    const res = patchFile(path.resolve(targetArg));
    console.log(`Result: ${res.reason}`);
    if (!res.success) {
      process.exit(1);
    }
    return;
  }

  // 2. Locate action in GitHub Actions environment
  const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
  console.log(`Workspace directory: ${workspace}`);

  const potentialRoots = [
    path.resolve(workspace, "..", "_actions"),
    path.resolve(workspace, "..", "..", "_actions"),
    path.resolve(workspace, "node_modules", "@upptime", "uptime-monitor"),
  ];

  let candidateFiles = [];
  for (const root of potentialRoots) {
    if (fs.existsSync(root)) {
      console.log(`Scanning action directory: ${root}`);
      const found = findActionIndexFiles(root);
      candidateFiles = candidateFiles.concat(found);
    }
  }

  // De-duplicate
  candidateFiles = Array.from(new Set(candidateFiles));

  if (candidateFiles.length === 0) {
    console.warn(
      "[WARNING] No upptime/uptime-monitor action bundles detected in runner search paths."
    );
    console.warn("Skipping patch. If running in CI, ensure the action was checked out.");
    return;
  }

  console.log(`Found ${candidateFiles.length} action candidate file(s):`);
  let patchedCount = 0;
  for (const file of candidateFiles) {
    console.log(`- Inspecting: ${file}`);
    const res = patchFile(file);
    console.log(`  -> ${res.reason}`);
    if (res.success) {
      patchedCount++;
    }
  }

  console.log(`Completed. Patched ${patchedCount}/${candidateFiles.length} action bundle(s).`);
}

if (require.main === module) {
  run();
}

module.exports = {
  patchFile,
  findActionIndexFiles,
  PATCH_START_MARKER,
  PATCH_END_MARKER,
  REPLACEMENT_BLOCK,
};
