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

console.log('\n--- _buildShelterChainBeam ---');

// Need WALK_FACTOR and minDistToPath for the chain builder
App.WALK_FACTOR = 1.3;  // effectiveRadius = radius * WALK_FACTOR
App.minDistToPath = function(point, path) {
  var min = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = point.distanceTo(path[i]);
    if (d < min) min = d;
  }
  return min;
};

// Copy beam search chain builder from route.js
App._buildShelterChainBeam = function(orig, dest, shelters, maxEdge, beamWidth) {
  beamWidth = beamWidth || 3;
  var straightLineDist = orig.distanceTo(dest);
  var maxSteps = Math.min(20, Math.ceil(straightLineDist / (maxEdge * 0.5)));
  var maxChainDist = straightLineDist * 1.5;
  var beams = [{ current: orig, chain: [], used: new Set(), chainDist: 0 }];
  for (var step = 0; step < maxSteps; step++) {
    var nextBeams = [];
    for (var bi = 0; bi < beams.length; bi++) {
      var beam = beams[bi];
      var distToTarget = beam.current.distanceTo(dest);
      if (distToTarget <= maxEdge) { nextBeams.push(beam); continue; }
      var candidates = [];
      for (var i = 0; i < shelters.length; i++) {
        var s = shelters[i];
        if (beam.used.has(s.id)) continue;
        var dFromCurr = beam.current.distanceTo(s.location);
        if (dFromCurr > maxEdge || dFromCurr < 30) continue;
        var dToTarget = s.location.distanceTo(dest);
        var progress = distToTarget - dToTarget;
        if (progress < maxEdge * 0.15) continue;
        var detour = dFromCurr + dToTarget - distToTarget;
        var score = progress - detour * 1.2;
        candidates.push({ shelter: s, score: score, hopDist: dFromCurr });
      }
      candidates.sort(function(a, b) { return b.score - a.score; });
      var expandCount = Math.min(beamWidth, candidates.length);
      if (expandCount === 0) { nextBeams.push(beam); continue; }
      for (var ci = 0; ci < expandCount; ci++) {
        var c = candidates[ci];
        var newChainDist = beam.chainDist + c.hopDist;
        var remaining = c.shelter.location.distanceTo(dest);
        if (newChainDist + remaining > maxChainDist) continue;
        var newUsed = new Set(beam.used);
        newUsed.add(c.shelter.id);
        nextBeams.push({
          current: c.shelter.location,
          chain: beam.chain.concat([c.shelter]),
          used: newUsed,
          chainDist: newChainDist,
        });
      }
    }
    if (!nextBeams.length) break;
    nextBeams.sort(function(a, b) {
      var aDist = a.current.distanceTo(dest);
      var bDist = b.current.distanceTo(dest);
      return (b.chain.length * 100 - bDist) - (a.chain.length * 100 - aDist);
    });
    beams = nextBeams.slice(0, beamWidth * 2);
  }
  return beams;
};

(function testBeamBasic() {
  // Origin in south TLV, destination in north — shelters along a parallel street
  var orig = L.latLng(32.063, 34.772);
  var dest = L.latLng(32.087, 34.782);

  var shelters = [
    { id: 'j1', lat: 32.067, lon: 34.775, location: L.latLng(32.067, 34.775) },
    { id: 'j2', lat: 32.071, lon: 34.776, location: L.latLng(32.071, 34.776) },
    { id: 'j3', lat: 32.075, lon: 34.777, location: L.latLng(32.075, 34.777) },
    { id: 'j4', lat: 32.079, lon: 34.778, location: L.latLng(32.079, 34.778) },
    { id: 'j5', lat: 32.083, lon: 34.780, location: L.latLng(32.083, 34.780) },
    { id: 'far', lat: 32.070, lon: 34.760, location: L.latLng(32.070, 34.760) },
  ];

  var beams = App._buildShelterChainBeam(orig, dest, shelters, 600);
  assert(beams.length >= 1, 'beam search returns at least one beam (got ' + beams.length + ')');

  // The best beam (longest chain) should have multiple shelters
  var bestBeam = beams.reduce(function(a, b) { return a.chain.length > b.chain.length ? a : b; });
  var ids = bestBeam.chain.map(function(s) { return s.id; });

  assert(bestBeam.chain.length >= 3, 'best beam has at least 3 shelters (got ' + bestBeam.chain.length + ')');
  assert(ids.indexOf('far') === -1, 'far-off shelter not included in best beam');

  // Verify forward progress in best beam
  var prevDist = orig.distanceTo(dest);
  var allForward = true;
  for (var i = 0; i < bestBeam.chain.length; i++) {
    var d = bestBeam.chain[i].location.distanceTo(dest);
    if (d >= prevDist) { allForward = false; break; }
    prevDist = d;
  }
  assert(allForward, 'best beam shelters all make forward progress');
})();

(function testBeamEmpty() {
  var orig = L.latLng(32.063, 34.772);
  var dest = L.latLng(32.087, 34.782);
  var beams = App._buildShelterChainBeam(orig, dest, [], 600);
  // Should return initial beam with empty chain
  assert(beams.length >= 1, 'returns at least one beam even with no shelters');
  assert(beams[0].chain.length === 0, 'empty shelters produces empty chain');
})();

(function testBeamNoProgress() {
  var orig = L.latLng(32.080, 34.780);
  var dest = L.latLng(32.087, 34.782);
  var shelters = [
    { id: 'back1', lat: 32.070, lon: 34.775, location: L.latLng(32.070, 34.775) },
    { id: 'back2', lat: 32.065, lon: 34.773, location: L.latLng(32.065, 34.773) },
  ];
  var beams = App._buildShelterChainBeam(orig, dest, shelters, 600);
  var maxChain = beams.reduce(function(a, b) { return a.chain.length > b.chain.length ? a : b; });
  assert(maxChain.chain.length === 0, 'no chain when shelters are behind origin');
})();

(function testBeamMultiplePaths() {
  // Two parallel corridors of shelters — beam search should explore both
  var orig = L.latLng(32.060, 34.775);
  var dest = L.latLng(32.080, 34.775);

  var shelters = [
    // West corridor
    { id: 'w1', lat: 32.065, lon: 34.773, location: L.latLng(32.065, 34.773) },
    { id: 'w2', lat: 32.070, lon: 34.773, location: L.latLng(32.070, 34.773) },
    { id: 'w3', lat: 32.075, lon: 34.773, location: L.latLng(32.075, 34.773) },
    // East corridor
    { id: 'e1', lat: 32.065, lon: 34.777, location: L.latLng(32.065, 34.777) },
    { id: 'e2', lat: 32.070, lon: 34.777, location: L.latLng(32.070, 34.777) },
    { id: 'e3', lat: 32.075, lon: 34.777, location: L.latLng(32.075, 34.777) },
  ];

  var beams = App._buildShelterChainBeam(orig, dest, shelters, 800, 3);
  // Should have beams using west corridor AND east corridor
  var usesWest = beams.some(function(b) {
    return b.chain.some(function(s) { return s.id.startsWith('w'); });
  });
  var usesEast = beams.some(function(b) {
    return b.chain.some(function(s) { return s.id.startsWith('e'); });
  });
  assert(usesWest && usesEast, 'beam search explores both west and east corridors');
})();

// --- Summary ---
console.log('\n' + (passed + failed) + ' tests, ' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed > 0 ? 1 : 0);
