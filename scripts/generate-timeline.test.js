/**
 * scripts/generate-timeline.test.js
 *
 * Automated tests for timeline generation, git log parsing,
 * time window filtering, and average response calculations.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseGitLog } = require("./generate-timeline");

console.log("Running Timeline Generator & Range Filter Tests...\n");

// Test 1: Git log parsing accuracy
console.log("Test 1: Parsing git log messages");
const sampleRawLog = `
2026-11-09T08:17:15Z|🟩 Company Profile is up (200 in 539 ms) [skip ci] [upptime]
2026-11-09T07:48:26Z|🟨 Company Profile experienced degraded performance (200 in 31200 ms) [skip ci] [upptime]
2026-11-09T07:42:09Z|🟩 Company Profile is up (200 in 1064 ms) [skip ci] [upptime]
2026-11-09T06:00:00Z|🟥 Company Profile is down (502 in 120 ms) [skip ci] [upptime]
2026-11-09T05:00:00Z|Some non-monitoring commit message
`;

const points = parseGitLog(sampleRawLog);
assert.strictEqual(points.length, 4, "Should parse 4 valid monitoring points, ignoring non-monitoring commit");

// Check chronological order (oldest to newest)
assert.strictEqual(points[0].time, "2026-11-09T06:00:00Z", "Oldest commit should be first");
assert.strictEqual(points[0].status, "down");
assert.strictEqual(points[0].ms, 120);
assert.strictEqual(points[0].httpCode, 502);

assert.strictEqual(points[1].ms, 1064);
assert.strictEqual(points[1].status, "up");

assert.strictEqual(points[2].status, "degraded");
assert.strictEqual(points[2].ms, 31200);

assert.strictEqual(points[3].time, "2026-11-09T08:17:15Z", "Newest commit should be last");
assert.strictEqual(points[3].ms, 539);
assert.strictEqual(points[3].status, "up");

console.log("✓ Test 1 passed\n");

// Test 2: Range Filtering Logic simulation
console.log("Test 2: Simulating time range filtering (7d, 14d, 30d, 60d, 180d, All)");

const now = new Date("2026-11-09T12:00:00Z").getTime();
const dayMs = 24 * 60 * 60 * 1000;

const mockData = [
  { time: new Date(now - 2 * dayMs).toISOString(), ms: 500 },   // 2d ago (in 7d)
  { time: new Date(now - 10 * dayMs).toISOString(), ms: 600 },  // 10d ago (in 14d)
  { time: new Date(now - 25 * dayMs).toISOString(), ms: 700 },  // 25d ago (in 30d)
  { time: new Date(now - 50 * dayMs).toISOString(), ms: 800 },  // 50d ago (in 60d)
  { time: new Date(now - 120 * dayMs).toISOString(), ms: 900 }, // 120d ago (in 180d)
  { time: new Date(now - 300 * dayMs).toISOString(), ms: 1000 },// 300d ago (in All)
];

function filterPoints(dataset, rangeKey, referenceTime = now) {
  if (rangeKey === "all") return dataset;
  const daysMap = { "7d": 7, "14d": 14, "30d": 30, "60d": 60, "180d": 180 };
  const days = daysMap[rangeKey];
  if (!days) return dataset;
  const cutoff = referenceTime - days * dayMs;
  return dataset.filter((p) => new Date(p.time).getTime() >= cutoff);
}

function calculateAverage(dataset) {
  if (!dataset || dataset.length === 0) return 0;
  const sum = dataset.reduce((acc, p) => acc + p.ms, 0);
  return Math.round(sum / dataset.length);
}

assert.strictEqual(filterPoints(mockData, "7d").length, 1);
assert.strictEqual(calculateAverage(filterPoints(mockData, "7d")), 500);

assert.strictEqual(filterPoints(mockData, "14d").length, 2);
assert.strictEqual(calculateAverage(filterPoints(mockData, "14d")), 550);

assert.strictEqual(filterPoints(mockData, "30d").length, 3);
assert.strictEqual(calculateAverage(filterPoints(mockData, "30d")), 600);

assert.strictEqual(filterPoints(mockData, "60d").length, 4);
assert.strictEqual(calculateAverage(filterPoints(mockData, "60d")), 650);

assert.strictEqual(filterPoints(mockData, "180d").length, 5);
assert.strictEqual(calculateAverage(filterPoints(mockData, "180d")), 700);

assert.strictEqual(filterPoints(mockData, "all").length, 6);
assert.strictEqual(calculateAverage(filterPoints(mockData, "all")), 750);

console.log("✓ Test 2 passed\n");

// Test 3: Validate generated JSON files in api/
console.log("Test 3: Checking generated API timeline artifacts");
const targetDirs = ["company-profile", "google", "c-website", "e-website", "rp-website"];
for (const slug of targetDirs) {
  const filePath = path.join(__dirname, "..", "api", slug, "history-timeline.json");
  assert.ok(fs.existsSync(filePath), `api/${slug}/history-timeline.json must exist`);
  const content = JSON.parse(fs.readFileSync(filePath, "utf8"));
  assert.ok(Array.isArray(content), "Content must be a JSON array");
  if (content.length > 0) {
    assert.ok(content[0].time, "Item must have time");
    assert.ok(typeof content[0].ms === "number", "Item ms must be number");
  }
}
console.log("✓ Test 3 passed\n");

console.log("All timeline generator and range tests passed successfully!");
