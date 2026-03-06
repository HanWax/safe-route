window.App = window.App || {};

App.nominatimGeocode = function(query) {
  return fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: query, format: 'json', limit: 1, countrycodes: 'il',
  }))
  .then(function(r) { return r.json(); })
  .then(function(results) {
    if (results.length) return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
    return null;
  });
};

App.nominatimReverse = function(lat, lng) {
  return fetch('https://nominatim.openstreetmap.org/reverse?' + new URLSearchParams({
    lat: lat, lon: lng, format: 'json',
  }))
  .then(function(r) { return r.json(); })
  .then(function(result) {
    return result && result.display_name ? result.display_name : null;
  });
};

App._extractLatLng = function(loc) {
  return {
    lat: typeof loc.lat === 'function' ? loc.lat() : loc.lat,
    lng: typeof loc.lng === 'function' ? loc.lng() : loc.lng,
  };
};

App.getRoute = function(origin, destination, waypoints) {
  var o = App._extractLatLng(origin);
  var d = App._extractLatLng(destination);
  var locations = [{ lat: o.lat, lon: o.lng }];
  if (waypoints && waypoints.length) {
    waypoints.forEach(function(w) {
      var c = App._extractLatLng(w);
      locations.push({ lat: c.lat, lon: c.lng, type: 'through' });
    });
  }
  locations.push({ lat: d.lat, lon: d.lng });

  return fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locations: locations, costing: 'pedestrian', directions_options: { units: 'kilometers' } }),
  })
  .then(function(resp) {
    if (!resp.ok) throw new Error('Route request failed (' + resp.status + ')');
    return resp.json();
  })
  .then(function(data) {
    if (!data.trip) { App.setStatus('Route error: no trip data', 'err'); return null; }
    var allPoints = [];
    data.trip.legs.forEach(function(leg) {
      allPoints = allPoints.concat(App._decodeValhalla(leg.shape));
    });
    var totalDistance = Math.round(data.trip.summary.length * 1000);
    var totalDuration = Math.round(data.trip.summary.time);
    return {
      path: allPoints,
      totalDistance: totalDistance,
      totalDuration: totalDuration,
      startLocation: allPoints[0],
      endLocation: allPoints[allPoints.length - 1],
    };
  })
  .catch(function(err) {
    App.setStatus('Route error: ' + err.message, 'err');
    return null;
  });
};

App._fetchCityShelters = async function(city, bbox) {
  var shelters = [];
  var params = new URLSearchParams({
    where: '1=1',
    geometry: bbox.west + ',' + bbox.south + ',' + bbox.east + ',' + bbox.north,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: city.outFields.join(','),
    outSR: '4326',
    returnGeometry: 'true',
    f: 'json',
  });

  var fetchUrl;
  if (city.staticUrl) {
    fetchUrl = city.staticUrl;
  } else {
    fetchUrl = city.queryUrl + '?' + params;
    if (city.useProxy) {
      fetchUrl = '/api/shelters-proxy?url=' + encodeURIComponent(fetchUrl);
    }
  }

  var resp = await fetch(fetchUrl);
  if (!resp.ok) throw new Error('Shelter data request failed (' + resp.status + ')');
  var data = await resp.json();

  if (data.error) {
    console.warn(city.id + ' GIS error:', data.error);
    return shelters;
  }

  (data.features || []).forEach(function(feat) {
    var parsed = city.parseFeat(feat);
    if (!parsed) return;
    shelters.push(Object.assign({}, parsed, {
      source: city.id,
      location: new google.maps.LatLng(parsed.lat, parsed.lon),
    }));
  });

  return shelters;
};

App.fetchShelters = async function(bbox, routePath) {
  var cities = App.detectCities(routePath);
  App.detectedCities = cities;
  App.detectedCity = cities[0];
  var shelters = [];

  // Fetch from all matching cities in parallel
  var results = await Promise.allSettled(
    cities.map(function(city) { return App._fetchCityShelters(city, bbox); })
  );

  results.forEach(function(result, i) {
    if (result.status === 'fulfilled') {
      shelters = shelters.concat(result.value);
    } else {
      console.warn(cities[i].id + ' GIS fetch failed', result.reason);
    }
  });

  // Merge community-reported shelters (if toggle is checked)
  var includeCommunity = document.getElementById('includeCommunity');
  if (!includeCommunity || includeCommunity.checked) {
    try {
      var commShelters = await App.fetchCommunityShelters(bbox);
      commShelters.forEach(function(cs) {
        cs.location = new google.maps.LatLng(cs.lat, cs.lng);
        shelters.push(cs);
      });
    } catch (e) {
      console.warn('community shelters merge failed', e);
    }
  }

  return shelters;
};

App._decodeValhalla = function(encoded) {
  // Valhalla uses precision 6 (Google uses 5)
  var inv = 1e-6;
  var decoded = [];
  var lat = 0, lng = 0;
  var i = 0;
  while (i < encoded.length) {
    var b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    decoded.push(new google.maps.LatLng(lat * inv, lng * inv));
  }
  return decoded;
};

App._getValhallaAlternatives = async function(orig, dest) {
  var body = JSON.stringify({
    locations: [
      { lat: orig.lat(), lon: orig.lng() },
      { lat: dest.lat(), lon: dest.lng() },
    ],
    costing: 'pedestrian',
    alternates: 5,
  });
  try {
    var resp = await fetch('https://valhalla1.openstreetmap.de/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    var data = await resp.json();
    var routes = [];
    if (data.trip) routes.push(data.trip);
    if (data.alternates) {
      data.alternates.forEach(function(alt) { if (alt.trip) routes.push(alt.trip); });
    }
    return routes.map(function(trip) {
      var shape = trip.legs[0].shape;
      return App._decodeValhalla(shape);
    });
  } catch (e) {
    console.warn('Valhalla alternatives fetch failed', e);
    return [];
  }
};

App._pickBestCorridor = function(directPath, altPaths, shelters, radius) {
  var bestPath = directPath;
  var bestCoverage = App.analyseRouteCoverage(directPath, shelters, radius);

  altPaths.forEach(function(altPath) {
    var coverage = App.analyseRouteCoverage(altPath, shelters, radius);
    if (coverage.coveredPct > bestCoverage.coveredPct ||
        (coverage.coveredPct === bestCoverage.coveredPct && (coverage.gapDist || 0) < (bestCoverage.gapDist || 0))) {
      bestPath = altPath;
      bestCoverage = coverage;
    }
  });

  return { path: bestPath, coverage: bestCoverage };
};

App._extractCorridorWaypoints = function(corridorPath, numWaypoints) {
  // Sample evenly-spaced points along the corridor to use as Google waypoints
  if (corridorPath.length < 3) return [];
  var step = Math.floor(corridorPath.length / (numWaypoints + 1));
  var waypoints = [];
  for (var i = 1; i <= numWaypoints; i++) {
    var idx = Math.min(i * step, corridorPath.length - 1);
    waypoints.push(corridorPath[idx]);
  }
  return waypoints;
};

App.buildShelterRoute = async function(orig, dest, directRoute, shelters, radius) {
  var coverageTarget = 100;
  if (!shelters.length) return { waypointRoute: null, usedShelters: [], achievedPct: 0 };

  var directCoverage = App.analyseRouteCoverage(directRoute.path, shelters, radius);

  // Explore alternative corridors via Valhalla
  var altPaths = await App._getValhallaAlternatives(
    directRoute.startLocation, directRoute.endLocation
  );
  var corridor = App._pickBestCorridor(directRoute.path, altPaths, shelters, radius);

  // If a Valhalla alternative is better, re-route Google through that corridor
  if (corridor.path !== directRoute.path && corridor.coverage.coveredPct > directCoverage.coveredPct) {
    var corridorWps = App._extractCorridorWaypoints(corridor.path, 5);
    try {
      var corridorRoute = await App.getRoute(orig, dest, corridorWps);
      if (corridorRoute) {
        var corridorCov = App.analyseRouteCoverage(corridorRoute.path, shelters, radius);
        if (corridorCov.coveredPct >= coverageTarget) {
          return { waypointRoute: corridorRoute, usedShelters: [], achievedPct: corridorCov.coveredPct };
        }
        // Use the better corridor as the new base for gap-patching
        if (corridorCov.coveredPct > directCoverage.coveredPct) {
          directRoute = corridorRoute;
          directCoverage = corridorCov;
        }
      }
    } catch (e) {
      console.warn('Corridor re-route failed, using direct route', e);
    }
  }
  if (directCoverage.coveredPct >= coverageTarget) {
    return { waypointRoute: directRoute, usedShelters: [], achievedPct: directCoverage.coveredPct };
  }

  var gapPoints = directRoute.path.filter(function(p) {
    return !App.isPointCovered(p, shelters, radius);
  });

  if (!gapPoints.length) {
    return { waypointRoute: directRoute, usedShelters: [], achievedPct: 100 };
  }

  var effectiveRadius = radius / App.WALK_FACTOR;
  var directGapDist = directCoverage.gapDist || 0;
  var bestRoute = null;
  var bestGapDist = directGapDist;
  var bestPct = directCoverage.coveredPct;
  var bestShelters = [];
  var usedIds = new Set();
  var selectedShelters = [];
  var MAX_WAYPOINTS = 23;
  var MAX_ITERATIONS = 3;
  // Reject detours that add more exposed distance than they save
  var MAX_DETOUR_RATIO = 1.5;
  var directDist = directRoute.totalDistance;

  for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    var currentPath = bestRoute ? bestRoute.path : directRoute.path;
    var currentGapPoints = currentPath.filter(function(p) { return !App.isPointCovered(p, shelters, radius); });

    if (!currentGapPoints.length || bestPct >= coverageTarget) break;
    if (selectedShelters.length >= MAX_WAYPOINTS) break;

    var candidates = shelters
      .filter(function(s) { return !usedIds.has(s.id); })
      .map(function(s) {
        var coverCount = 0;
        for (var j = 0; j < currentGapPoints.length; j++) {
          if (google.maps.geometry.spherical.computeDistanceBetween(currentGapPoints[j], s.location) <= effectiveRadius * 2) {
            coverCount++;
          }
        }
        var routeDist = App.minDistToPath(s.location, currentPath);
        return { shelter: s, coverCount: coverCount, routeDist: routeDist };
      })
      .filter(function(x) { return x.coverCount > 0 && x.routeDist < radius * 2 / App.WALK_FACTOR; })
      .sort(function(a, b) { return b.coverCount - a.coverCount || a.routeDist - b.routeDist; });

    var batchSize = Math.min(8, MAX_WAYPOINTS - selectedShelters.length);
    var added = 0;
    for (var ci = 0; ci < candidates.length; ci++) {
      if (added >= batchSize) break;
      var c = candidates[ci];
      if (!usedIds.has(c.shelter.id)) {
        usedIds.add(c.shelter.id);
        selectedShelters.push(c.shelter);
        added++;
      }
    }

    if (!added) break;

    App.setStatus(App.t('statusRoutingWaypoints')(iteration + 1, selectedShelters.length), 'info');

    try {
      var orderedShelters = App.orderWaypointsAlongPath(selectedShelters, directRoute.path);
      var waypoints = orderedShelters.map(function(s) { return new google.maps.LatLng(s.lat, s.lon); });
      var wpRoute = await App.getRoute(orig, dest, waypoints);
      if (wpRoute) {
        // Reject routes that are too long compared to the direct path
        if (wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO) {
          // Revert to previous best and stop adding waypoints
          selectedShelters.length = 0;
          bestShelters.forEach(function(s) { selectedShelters.push(s); });
          usedIds.clear();
          bestShelters.forEach(function(s) { usedIds.add(s.id); });
          break;
        }
        var coverage = App.analyseRouteCoverage(wpRoute.path, shelters, radius);
        var newGapDist = coverage.gapDist || 0;
        // Accept route only if it reduces total exposed (uncovered) meters
        if (newGapDist < bestGapDist) {
          bestRoute = wpRoute;
          bestGapDist = newGapDist;
          bestPct = coverage.coveredPct;
          bestShelters = selectedShelters.slice();
        } else {
          selectedShelters.length = 0;
          bestShelters.forEach(function(s) { selectedShelters.push(s); });
          usedIds.clear();
          bestShelters.forEach(function(s) { usedIds.add(s.id); });
          if (!bestRoute) break;
        }
        if (bestPct >= coverageTarget) break;
      }
    } catch (e) {
      console.warn('Waypoint route iteration ' + (iteration + 1) + ' failed', e);
      break;
    }
  }

  if (bestRoute) {
    if (bestPct < coverageTarget) {
      App.setStatus(App.t('statusBestAchievable')(Math.round(bestPct)), 'info');
    }
    return { waypointRoute: bestRoute, usedShelters: bestShelters, achievedPct: bestPct };
  }

  // Fallback: single-pass nearest-shelter approach (only close shelters)
  var waypointShelterSet = new Set();
  var waypointShelters = [];
  for (var gi = 0; gi < gapPoints.length; gi++) {
    var nearest = null, nearestD = Infinity;
    for (var si = 0; si < shelters.length; si++) {
      var d = google.maps.geometry.spherical.computeDistanceBetween(gapPoints[gi], shelters[si].location);
      if (d < nearestD) { nearestD = d; nearest = shelters[si]; }
    }
    if (nearest && !waypointShelterSet.has(nearest.id) && nearestD < (radius * 2) / App.WALK_FACTOR) {
      waypointShelterSet.add(nearest.id);
      waypointShelters.push(nearest);
    }
    if (waypointShelters.length >= MAX_WAYPOINTS) break;
  }

  if (!waypointShelters.length) return { waypointRoute: null, usedShelters: [], achievedPct: directCoverage.coveredPct };

  try {
    var orderedFallback = App.orderWaypointsAlongPath(waypointShelters, directRoute.path);
    var waypoints = orderedFallback.map(function(s) { return new google.maps.LatLng(s.lat, s.lon); });
    var wpRoute = await App.getRoute(orig, dest, waypoints);
    if (wpRoute && wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO) {
      return { waypointRoute: null, usedShelters: [], achievedPct: directCoverage.coveredPct };
    }
    var fallbackCoverage = wpRoute ? App.analyseRouteCoverage(wpRoute.path, shelters, radius) : null;
    var fallbackGapDist = fallbackCoverage ? (fallbackCoverage.gapDist || 0) : Infinity;
    // Only use fallback route if it actually reduces exposed distance
    if (fallbackGapDist < directGapDist) {
      return { waypointRoute: wpRoute, usedShelters: waypointShelters, achievedPct: fallbackCoverage.coveredPct };
    }
    return { waypointRoute: null, usedShelters: [], achievedPct: directCoverage.coveredPct };
  } catch (e) {
    console.warn('Waypoint route failed, falling back', e);
    return { waypointRoute: directRoute, usedShelters: [], achievedPct: directCoverage.coveredPct };
  }
};

App.orderWaypointsAlongPath = function(shelters, path) {
  return shelters.slice().sort(function(a, b) {
    return App.projectOntoPath(a, path) - App.projectOntoPath(b, path);
  });
};

App.projectOntoPath = function(shelter, path) {
  var loc = new google.maps.LatLng(shelter.lat, shelter.lon);
  var bestIdx = 0, bestDist = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = google.maps.geometry.spherical.computeDistanceBetween(loc, path[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
};

App.analyseRouteCoverage = function(path, shelters, radius) {
  if (!path.length) return { coveredPct: 0, gaps: [], coveredPolyline: [], gapPolylines: [] };

  var tags = path.map(function(p) { return App.isPointCovered(p, shelters, radius); });

  var runs = [];
  var cur = { covered: tags[0], points: [path[0]] };
  for (var i = 1; i < path.length; i++) {
    if (tags[i] === cur.covered) {
      cur.points.push(path[i]);
    } else {
      runs.push(cur);
      cur = { covered: tags[i], points: [path[i-1], path[i]] };
    }
  }
  runs.push(cur);

  var coveredDist = 0, gapDist = 0;
  var coveredSegs = [], gapSegs = [], gaps = [];

  runs.forEach(function(run) {
    var d = 0;
    for (var j = 1; j < run.points.length; j++)
      d += google.maps.geometry.spherical.computeDistanceBetween(run.points[j-1], run.points[j]);

    if (run.covered) {
      coveredDist += d;
      coveredSegs.push(run.points);
    } else {
      gapDist += d;
      gapSegs.push(run.points);
      gaps.push({ points: run.points, distMeters: Math.round(d) });
    }
  });

  var total = coveredDist + gapDist;
  var coveredPct = total > 0 ? Math.round((coveredDist / total) * 10000) / 100 : 100;

  return { coveredPct: coveredPct, gaps: gaps, coveredPolyline: coveredSegs, gapPolylines: gapSegs, gapDist: Math.round(gapDist) };
};

App.isPointCovered = function(point, shelters, radius) {
  var effectiveRadius = radius / App.WALK_FACTOR;
  for (var i = 0; i < shelters.length; i++) {
    if (google.maps.geometry.spherical.computeDistanceBetween(point, shelters[i].location) <= effectiveRadius)
      return true;
  }
  return false;
};

App.setupDraggableRoute = function() {};
