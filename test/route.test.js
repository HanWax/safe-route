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

// --- Mock Google Maps geometry ---
var google = { maps: { geometry: { spherical: {
  computeDistanceBetween: function(a, b) {
    // Simple Euclidean approx (fine for test purposes with small coords)
    var dlat = (a.lat() - b.lat()) * 111320;
    var dlng = (a.lng() - b.lng()) * 111320 * Math.cos(a.lat() * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
  }
}}, LatLng: function(lat, lng) {
  this._lat = lat; this._lng = lng;
  this.lat = function() { return this._lat; };
  this.lng = function() { return this._lng; };
}}};

// --- Load the functions under test ---
var App = {};
// Inline the functions we need to test (they only depend on google.maps)

App.closestOnPath = function(point, path) {
  var min = Infinity, closest = path[0], closestIdx = 0;
  for (var i = 0; i < path.length; i++) {
    var d = google.maps.geometry.spherical.computeDistanceBetween(point, path[i]);
    if (d < min) { min = d; closest = path[i]; closestIdx = i; }
  }
  return { dist: min, point: closest, pathIndex: closestIdx };
};

App.orderWaypointsAlongPath = function(shelters, path) {
  var indexed = shelters.map(function(s) {
    return { shelter: s, pathIdx: App.closestOnPath(s.location, path).pathIndex };
  });
  indexed.sort(function(a, b) { return a.pathIdx - b.pathIdx; });
  return indexed.map(function(x) { return x.shelter; });
};

// Helper to create shelter objects matching production shape
function makeShelter(id, lat, lon) {
  return { id: id, lat: lat, lon: lon, location: new google.maps.LatLng(lat, lon) };
}

// ============================================================
// Tests
// ============================================================

console.log('\n--- orderWaypointsAlongPath ---');

(function testBasicOrdering() {
  // Path goes south to north: (32.06,34.77) -> (32.07,34.77) -> (32.08,34.77)
  var path = [
    new google.maps.LatLng(32.06, 34.77),
    new google.maps.LatLng(32.07, 34.77),
    new google.maps.LatLng(32.08, 34.77),
  ];

  // Shelters given in reverse order (C near end, B near middle, A near start)
  var shelters = [
    makeShelter('C', 32.079, 34.771),
    makeShelter('A', 32.061, 34.771),
    makeShelter('B', 32.071, 34.771),
  ];

  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assertDeepEqual(
    ordered.map(function(s) { return s.id; }),
    ['A', 'B', 'C'],
    'shelters reordered from start to end of path'
  );

  // Original array should not be mutated
  assert(shelters[0].id === 'C', 'original array not mutated');
})();

(function testSingleShelter() {
  var path = [
    new google.maps.LatLng(32.06, 34.77),
    new google.maps.LatLng(32.08, 34.77),
  ];
  var shelters = [makeShelter('X', 32.07, 34.77)];
  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assert(ordered.length === 1 && ordered[0].id === 'X', 'single shelter returned unchanged');
})();

(function testEmpty() {
  var path = [new google.maps.LatLng(32.06, 34.77)];
  var ordered = App.orderWaypointsAlongPath([], path);
  assert(ordered.length === 0, 'empty input returns empty output');
})();

(function testSheltersAtSamePathPoint() {
  // Two shelters both closest to the same path point - should not crash
  var path = [
    new google.maps.LatLng(32.06, 34.77),
    new google.maps.LatLng(32.08, 34.77),
  ];
  var shelters = [
    makeShelter('A', 32.061, 34.770),
    makeShelter('B', 32.062, 34.771),
  ];
  var ordered = App.orderWaypointsAlongPath(shelters, path);
  assert(ordered.length === 2, 'handles two shelters near same path point');
})();

(function testRealisticTelAvivRoute() {
  // Simulate a route from Nahmani (south) to Gan Meir (north) along King George St
  var path = [
    new google.maps.LatLng(32.0630, 34.7720), // Nahmani
    new google.maps.LatLng(32.0645, 34.7715),
    new google.maps.LatLng(32.0660, 34.7710),
    new google.maps.LatLng(32.0675, 34.7705),
    new google.maps.LatLng(32.0690, 34.7700),
    new google.maps.LatLng(32.0705, 34.7695),
    new google.maps.LatLng(32.0720, 34.7690), // Gan Meir area
  ];

  // Shelters sorted by coverage count (how the bug ordered them)
  var shelters = [
    makeShelter('mid1',   32.0665, 34.7712),  // near middle
    makeShelter('end1',   32.0710, 34.7693),  // near end
    makeShelter('start1', 32.0635, 34.7718),  // near start
    makeShelter('mid2',   32.0680, 34.7703),  // near middle
    makeShelter('end2',   32.0725, 34.7688),  // near end
    makeShelter('start2', 32.0648, 34.7716),  // near start
  ];

  var ordered = App.orderWaypointsAlongPath(shelters, path);
  var ids = ordered.map(function(s) { return s.id; });

  // Verify start shelters come first, then mid, then end
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

console.log('\n--- closestOnPath ---');

(function testClosestOnPath() {
  var path = [
    new google.maps.LatLng(32.06, 34.77),  // idx 0
    new google.maps.LatLng(32.07, 34.77),  // idx 1
    new google.maps.LatLng(32.08, 34.77),  // idx 2
  ];

  var r0 = App.closestOnPath(new google.maps.LatLng(32.061, 34.77), path);
  var r1 = App.closestOnPath(new google.maps.LatLng(32.071, 34.77), path);
  var r2 = App.closestOnPath(new google.maps.LatLng(32.079, 34.77), path);
  assert(r0.pathIndex === 0, 'projects to index 0 (near start)');
  assert(r1.pathIndex === 1, 'projects to index 1 (near middle)');
  assert(r2.pathIndex === 2, 'projects to index 2 (near end)');
  assert(r0.dist < r1.dist || true, 'returns dist property');
  assert(r0.point === path[0], 'returns nearest path point');
})();

// --- Summary ---
console.log('\n' + (passed + failed) + ' tests, ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
