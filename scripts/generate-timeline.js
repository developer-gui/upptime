/**
 * scripts/generate-timeline.js
 *
 * Generates static historical time-series data from git commit logs for all
 * endpoints tracked in history/*.yml.
 *
 * Outputs:
 * - api/{slug}/history-timeline.json (repo API artifact)
 * - assets/api/{slug}/history-timeline.json (automatically copied by site build)
 *
 * This enables the frontend status page to provide multi-range filtering
 * (7d, 14d, 30d, 60d, 180d, All) with 0 GitHub API rate-limit risk.
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Parses raw git log string into structured timeline points.
 * Format expected: "%aI|%s" (ISO date | Subject)
 */
function parseGitLog(rawLog) {
  if (!rawLog || typeof rawLog !== "string") return [];

  const lines = rawLog.trim().split("\n").filter(Boolean);
  const points = [];

  for (const line of lines) {
    const separatorIdx = line.indexOf("|");
    if (separatorIdx === -1) continue;

    const isoDate = line.slice(0, separatorIdx).trim();
    const message = line.slice(separatorIdx + 1).trim();

    // Match response time (e.g. "in 539 ms", "in 539ms")
    const msMatch = message.match(/(?:in\s+)(\d+)\s*ms/i);
    const ms = msMatch ? parseInt(msMatch[1], 10) : null;

    // Match HTTP status code (e.g. "(200 in", "(502 in")
    const codeMatch = message.match(/\((\d{3})\b/);
    const httpCode = codeMatch ? parseInt(codeMatch[1], 10) : 200;

    // Determine status
    let status = "up";
    if (message.includes("is down") || message.includes("was down")) {
      status = "down";
    } else if (message.includes("degraded")) {
      status = "degraded";
    } else if (httpCode >= 400 || httpCode === 0) {
      status = "down";
    }

    // Only include commits that have valid response time information
    if (ms !== null && !isNaN(ms)) {
      points.push({
        time: isoDate,
        ms,
        httpCode,
        status,
      });
    }
  }

  // Sort chronological: oldest to newest
  points.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  return points;
}

/**
 * Extracts git log for a specific history file and generates JSON.
 */
function generateTimelineForSlug(slug, cwd = path.resolve(__dirname, "..")) {
  const historyFile = `history/${slug}.yml`;
  const historyPath = path.join(cwd, historyFile);

  if (!fs.existsSync(historyPath)) {
    console.warn(`[WARN] History file not found: ${historyPath}`);
    return [];
  }

  try {
    const rawLog = execSync(`git log --format="%aI|%s" -- ${historyFile}`, {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    const points = parseGitLog(rawLog);

    // Write to api/{slug}/history-timeline.json
    const apiTargetDir = path.join(cwd, "api", slug);
    if (!fs.existsSync(apiTargetDir)) {
      fs.mkdirSync(apiTargetDir, { recursive: true });
    }
    const apiOutputFile = path.join(apiTargetDir, "history-timeline.json");
    fs.writeFileSync(apiOutputFile, JSON.stringify(points, null, 2), "utf8");

    console.log(`[OK] Generated timeline for ${slug} (${points.length} data points)`);

    return points;
  } catch (error) {
    console.error(`[ERROR] Failed to extract git log for ${slug}:`, error.message);
    return [];
  }
}

/**
 * Scans all history/*.yml files and generates timelines.
 */
function run(cwd = path.resolve(__dirname, "..")) {
  console.log("=== Upptime Static Timeline Data Generator ===");

  const historyDir = path.join(cwd, "history");
  if (!fs.existsSync(historyDir)) {
    console.warn(`History directory not found at ${historyDir}`);
    return;
  }

  const files = fs
    .readdirSync(historyDir)
    .filter((f) => f.endsWith(".yml") && f !== "summary.yml");

  console.log(`Found ${files.length} tracked endpoint(s) in history/`);

  let totalPoints = 0;
  for (const file of files) {
    const slug = file.replace(/\.yml$/, "");
    const points = generateTimelineForSlug(slug, cwd);
    totalPoints += points.length;
  }

  console.log(`Timeline generation complete. Total records: ${totalPoints}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  parseGitLog,
  generateTimelineForSlug,
  run,
};
