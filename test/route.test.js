// Standalone test for route waypoint ordering logic
// Run: node test/route.test.js

var passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function assertDeepEqual(actual, expected, msg) {
  var a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a === b) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg + '\n    expected: ' + b + '\n    actual:   ' + a); }
}

// --- Mock Leaflet L.latLng ---
function LatLng(lat, lng) {
  this.lat = lat;
  this.lng = lng;
}
LatLng.prototype.distanceTo = function(other) {
  // Simple Euclidean approx (fine for test purposes with small coords)
  var dlat = (this.lat - other.lat) * 111320;
  var dlng = (this.lng - other.lng) * 111320 * Math.cos(this.lat * Math.PI / 180);
  return Math.sqrt(dlat * dlat + dlng * dlng);
};

var L = {
  latLng: function(lat, lng) { return new LatLng(lat, lng); }
};

// --- Load the functions under test ---
var App = {};

App.projectOntoPath = function(shelter, path) {
  var loc = L.latLng(shelter.lat, shelter.lon);
  var bestIdx = 0, bestDist = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = loc.distanceTo(path[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
};

App.orderWaypointsAlongPath = function(shelters, path) {
  return shelters.slice().sort(function(a, b) {
    return App.projectOntoPath(a, path) - App.projectOntoPath(b, path);
  });
};

// ============================================================
// Tests
// ============================================================

console.log('\n--- orderWaypointsAlongPath ---');

(function testBasicOrdering() {
  var path = [
    L.latLng(32.06, 34.77),
    L.latLng(32.07, 34.77),
    L.latLng(32.08, 34.77),
  ];

  var shelters = [
    { id: 'C', lat: 32.079, lon: 34.771 },
    { id: 'A', lat: 32.061, lon: 34.771 },
    { id: 'B', lat: 32.071, lon: 34.771 },
  ];

  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assertDeepEqual(
    ordered.map(function(s) { return s.id; }),
    ['A', 'B', 'C'],
    'shelters reordered from start to end of path'
  );

  assert(shelters[0].id === 'C', 'original array not mutated');
})();

(function testSingleShelter() {
  var path = [
    L.latLng(32.06, 34.77),
    L.latLng(32.08, 34.77),
  ];
  var shelters = [{ id: 'X', lat: 32.07, lon: 34.77 }];
  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assert(ordered.length === 1 && ordered[0].id === 'X', 'single shelter returned unchanged');
})();

(function testEmpty() {
  var path = [L.latLng(32.06, 34.77)];
  var ordered = App.orderWaypointsAlongPath([], path);
  assert(ordered.length === 0, 'empty input returns empty output');
})();

(function testSheltersAtSamePathPoint() {
  var path = [
    L.latLng(32.06, 34.77),
    L.latLng(32.08, 34.77),
  ];
  var shelters = [
    { id: 'A', lat: 32.061, lon: 34.770 },
    { id: 'B', lat: 32.062, lon: 34.771 },
  ];
  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assert(ordered.length === 2, 'handles two shelters near same path point');
})();

(function testRealisticTelAvivRoute() {
  var path = [
    L.latLng(32.0630, 34.7720),
    L.latLng(32.0645, 34.7715),
    L.latLng(32.0660, 34.7710),
    L.latLng(32.0675, 34.7705),
    L.latLng(32.0690, 34.7700),
    L.latLng(32.0705, 34.7695),
    L.latLng(32.0720, 34.7690),
  ];

  var shelters = [
    { id: 'mid1',   lat: 32.0665, lon: 34.7712 },
    { id: 'end1',   lat: 32.0710, lon: 34.7693 },
    { id: 'start1', lat: 32.0635, lon: 34.7718 },
    { id: 'mid2',   lat: 32.0680, lon: 34.7703 },
    { id: 'end2',   lat: 32.0725, lon: 34.7688 },
    { id: 'start2', lat: 32.0648, lon: 34.7716 },
  ];

  var ordered = App.orderWaypointsAlongPath(shelters, path);
  var ids = ordered.map(function(s) { return s.id; });

  var startIdx1 = ids.indexOf('start1');
  var startIdx2 = ids.indexOf('start2');
  var midIdx1 = ids.indexOf('mid1');
  var midIdx2 = ids.indexOf('mid2');
  var endIdx1 = ids.indexOf('end1');
  var endIdx2 = ids.indexOf('end2');

  assert(startIdx1 < midIdx1 && startIdx1 < endIdx1, 'start1 before mid and end shelters');
  assert(startIdx2 < endIdx1 && startIdx2 < endIdx2, 'start2 before end shelters');
  assert(midIdx1 < endIdx1, 'mid1 before end1');
  assert(midIdx2 < endIdx2, 'mid2 before end2');
})();

console.log('\n--- projectOntoPath ---');

(function testProjectOntoPath() {
  var path = [
    L.latLng(32.06, 34.77),
    L.latLng(32.07, 34.77),
    L.latLng(32.08, 34.77),
  ];

  assert(App.projectOntoPath({ lat: 32.061, lon: 34.77 }, path) === 0, 'projects to index 0 (near start)');
  assert(App.projectOntoPath({ lat: 32.071, lon: 34.77 }, path) === 1, 'projects to index 1 (near middle)');
  assert(App.projectOntoPath({ lat: 32.079, lon: 34.77 }, path) === 2, 'projects to index 2 (near end)');
})();

// --- Summary ---
console.log('\n' + (passed + failed) + ' tests, ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
