window.App = window.App || {};

App.nominatimGeocode = function(query) {
  var q = query;
  if (!/israel/i.test(q)) q += ', Israel';
  return fetch('https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: q, format: 'json', limit: 1, countrycodes: 'il',
  }))
  .then(function(r) { return r.json(); })
  .then(function(results) {
    if (results.length) return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
    return null;
  });
};

App.geocode = function(query) {
  return App.nominatimGeocode(query);
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
  return { lat: loc.lat, lng: loc.lng };
};

App._parseValhallaTrip = function(trip) {
  var allPoints = [];
  trip.legs.forEach(function(leg) {
    allPoints = allPoints.concat(App._decodeValhalla(leg.shape));
  });
  return {
    path: allPoints,
    totalDistance: Math.round(trip.summary.length * 1000),
    totalDuration: Math.round(trip.summary.time),
    startLocation: allPoints[0],
    endLocation: allPoints[allPoints.length - 1],
  };
};

App.getRoute = function(origin, destination, waypoints, options) {
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

  var body = { locations: locations, costing: 'pedestrian', directions_options: { units: 'kilometers' } };
  if (options && options.alternates) body.alternates = options.alternates;

  return fetch('https://valhalla1.openstreetmap.de/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  .then(function(resp) {
    if (!resp.ok) throw new Error('Route request failed (' + resp.status + ')');
    return resp.json();
  })
  .then(function(data) {
    if (!data.trip) { App.setStatus('Route error: no trip data', 'err'); return null; }
    var primary = App._parseValhallaTrip(data.trip);
    if (options && options.alternates) {
      primary.alternatives = [];
      if (data.alternates) {
        data.alternates.forEach(function(alt) {
          if (alt.trip) primary.alternatives.push(App._parseValhallaTrip(alt.trip));
        });
      }
    }
    return primary;
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
      location: L.latLng(parsed.lat, parsed.lon),
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
        cs.location = L.latLng(cs.lat, cs.lng);
        shelters.push(cs);
      });
    } catch (e) {
      console.warn('community shelters merge failed', e);
    }
  }

  return shelters;
};

App._decodeValhalla = function(encoded) {
  // Valhalla uses precision 6
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
    decoded.push(L.latLng(lat * inv, lng * inv));
  }
  return decoded;
};

App._routeBBox = function(origin, destination, padding) {
  var lats = [origin.lat, destination.lat];
  var lngs = [origin.lng, destination.lng];
  var latSpan = Math.abs(lats[0] - lats[1]);
  var lngSpan = Math.abs(lngs[0] - lngs[1]);
  var pad = padding || 0.3;
  var latPad = Math.max(latSpan * pad, 0.002);
  var lngPad = Math.max(lngSpan * pad, 0.002);
  return {
    south: Math.min(lats[0], lats[1]) - latPad,
    north: Math.max(lats[0], lats[1]) + latPad,
    west: Math.min(lngs[0], lngs[1]) - lngPad,
    east: Math.max(lngs[0], lngs[1]) + lngPad,
  };
};

App._pointInBBox = function(p, bbox) {
  return p.lat >= bbox.south && p.lat <= bbox.north && p.lng >= bbox.west && p.lng <= bbox.east;
};

App._pathExceedsBBox = function(path, bbox) {
  var outCount = 0;
  for (var i = 0; i < path.length; i++) {
    if (!App._pointInBBox(path[i], bbox)) outCount++;
  }
  return outCount / path.length > 0.05;
};

// Project each route point onto the O→D axis. Returns true if any point
// extends beyond origin (t < -tolerance) or beyond destination (t > 1+tolerance).
// This catches routes that overshoot past endpoints and loop back.
App._routeOvershoots = function(path, origin, destination, tolerance) {
  tolerance = tolerance || 0.1;
  var dx = destination.lng - origin.lng;
  var dy = destination.lat - origin.lat;
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return false;
  for (var i = 0; i < path.length; i++) {
    var px = path[i].lng - origin.lng;
    var py = path[i].lat - origin.lat;
    var t = (px * dx + py * dy) / lenSq;
    if (t < -tolerance || t > 1 + tolerance) return true;
  }
  return false;
};

App._pickBestCorridor = function(directPath, altPaths, shelters, radius, orig, dest) {
  var bestPath = directPath;
  var bestCoverage = App.analyseRouteCoverage(directPath, shelters, radius);

  altPaths.forEach(function(altPath) {
    if (orig && dest && App._routeOvershoots(altPath, orig, dest)) return;
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

  var bbox = App._routeBBox(orig, dest);

  var directCoverage = App.analyseRouteCoverage(directRoute.path, shelters, radius);

  var altPaths = (directRoute.alternatives || []).map(function(alt) { return alt.path; });
  var corridor = App._pickBestCorridor(directRoute.path, altPaths, shelters, radius, orig, dest);

  if (corridor.path !== directRoute.path && corridor.coverage.coveredPct > directCoverage.coveredPct) {
    var corridorWps = App._extractCorridorWaypoints(corridor.path, 5)
      .filter(function(wp) { return App._pointInBBox(wp, bbox); });
    if (corridorWps.length) {
      try {
        var corridorRoute = await App.getRoute(orig, dest, corridorWps);
        if (corridorRoute && !App._routeOvershoots(corridorRoute.path, orig, dest)) {
          var corridorCov = App.analyseRouteCoverage(corridorRoute.path, shelters, radius);
          if (corridorCov.coveredPct >= coverageTarget) {
            return { waypointRoute: corridorRoute, usedShelters: [], achievedPct: corridorCov.coveredPct };
          }
          if (corridorCov.coveredPct > directCoverage.coveredPct) {
            directRoute = corridorRoute;
            directCoverage = corridorCov;
          }
        }
      } catch (e) {
        console.warn('Corridor re-route failed, using direct route', e);
      }
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
  var MAX_DETOUR_RATIO = 1.5;
  var directDist = directRoute.totalDistance;

  for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    var currentPath = bestRoute ? bestRoute.path : directRoute.path;
    var currentGapPoints = currentPath.filter(function(p) { return !App.isPointCovered(p, shelters, radius); });

    if (!currentGapPoints.length || bestPct >= coverageTarget) break;
    if (selectedShelters.length >= MAX_WAYPOINTS) break;

    var candidates = shelters
      .filter(function(s) { return !usedIds.has(s.id) && App._pointInBBox(s.location, bbox); })
      .map(function(s) {
        var coverCount = 0;
        for (var j = 0; j < currentGapPoints.length; j++) {
          if (currentGapPoints[j].distanceTo(s.location) <= effectiveRadius * 2) {
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
      var waypoints = orderedShelters.map(function(s) { return L.latLng(s.lat, s.lon); });
      var wpRoute = await App.getRoute(orig, dest, waypoints);
      if (wpRoute) {
        if (wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO || App._routeOvershoots(wpRoute.path, orig, dest)) {
          selectedShelters.length = 0;
          bestShelters.forEach(function(s) { selectedShelters.push(s); });
          usedIds.clear();
          bestShelters.forEach(function(s) { usedIds.add(s.id); });
          break;
        }
        var coverage = App.analyseRouteCoverage(wpRoute.path, shelters, radius);
        var newGapDist = coverage.gapDist || 0;
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

  // Fallback: single-pass nearest-shelter approach
  var waypointShelterSet = new Set();
  var waypointShelters = [];
  for (var gi = 0; gi < gapPoints.length; gi++) {
    var nearest = null, nearestD = Infinity;
    for (var si = 0; si < shelters.length; si++) {
      if (!App._pointInBBox(shelters[si].location, bbox)) continue;
      var d = gapPoints[gi].distanceTo(shelters[si].location);
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
    var waypoints = orderedFallback.map(function(s) { return L.latLng(s.lat, s.lon); });
    var wpRoute = await App.getRoute(orig, dest, waypoints);
    if (wpRoute && (wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO || App._routeOvershoots(wpRoute.path, orig, dest))) {
      return { waypointRoute: null, usedShelters: [], achievedPct: directCoverage.coveredPct };
    }
    var fallbackCoverage = wpRoute ? App.analyseRouteCoverage(wpRoute.path, shelters, radius) : null;
    var fallbackGapDist = fallbackCoverage ? (fallbackCoverage.gapDist || 0) : Infinity;
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
  var loc = L.latLng(shelter.lat, shelter.lon);
  var bestIdx = 0, bestDist = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = loc.distanceTo(path[i]);
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
      d += run.points[j-1].distanceTo(run.points[j]);

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

App.setupDraggableRoute = function(orig, dest, finalRoute, shelters, radius) {
  App._dragCleanup();
  App._dragMarkers = [];
  App._dragOrig = orig;
  App._dragDest = dest;
  App._dragShelters = shelters;
  App._dragRadius = radius;
  App._dragPath = finalRoute.path;

  var mapContainer = App.map.getContainer();

  // Track mouse proximity to route for cursor hint
  App._dragMouseMove = function(e) {
    if (!App._dragPath || App._dragging) return;
    var px = App.map.mouseEventToContainerPoint(e);
    var near = App._nearRoute(px, 20);
    mapContainer.style.cursor = near ? 'pointer' : '';
  };

  // Mousedown near route: create marker, start dragging immediately
  App._dragMouseDown = function(e) {
    if (!App._dragPath || e.button !== 0) return;
    var px = App.map.mouseEventToContainerPoint(e);
    if (!App._nearRoute(px, 20)) return;

    e.preventDefault();
    e.stopPropagation();

    var latlng = App.map.mouseEventToLatLng(e);
    App.map.dragging.disable();
    App._dragging = true;

    // Create the waypoint marker
    var marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'drag-waypoint',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#0f0f0f;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
      zIndexOffset: 500,
      interactive: false,
    }).addTo(App.map);
    App._dragMarkers.push(marker);
    App.mapObjects.push(marker);

    // Follow mouse while dragging
    function onMove(ev) {
      var ll = App.map.mouseEventToLatLng(ev);
      marker.setLatLng(ll);
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      App.map.dragging.enable();
      App._dragging = false;
      mapContainer.style.cursor = '';

      // Replace with a proper draggable marker at the final position
      var finalLatLng = marker.getLatLng();
      marker.remove();
      var idx = App._dragMarkers.indexOf(marker);

      var newMarker = L.marker(finalLatLng, {
        draggable: true,
        icon: L.divIcon({
          className: 'drag-waypoint',
          html: '<div style="width:14px;height:14px;border-radius:50%;background:#0f0f0f;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
        zIndexOffset: 500,
      }).addTo(App.map);

      if (idx !== -1) App._dragMarkers[idx] = newMarker;
      App.mapObjects.push(newMarker);

      newMarker.on('dragend', function() {
        App._rerouteFromDragMarkers();
      });
      newMarker.on('contextmenu', function() {
        newMarker.remove();
        App._dragMarkers = App._dragMarkers.filter(function(m) { return m !== newMarker; });
        App._rerouteFromDragMarkers();
      });

      App._rerouteFromDragMarkers();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  mapContainer.addEventListener('mousemove', App._dragMouseMove);
  mapContainer.addEventListener('mousedown', App._dragMouseDown);
};

App._dragCleanup = function() {
  if (App._dragMouseMove || App._dragMouseDown) {
    var c = App.map.getContainer();
    c.removeEventListener('mousemove', App._dragMouseMove);
    c.removeEventListener('mousedown', App._dragMouseDown);
    c.style.cursor = '';
    App._dragMouseMove = null;
    App._dragMouseDown = null;
  }
  if (App._dragMarkers) {
    App._dragMarkers.forEach(function(m) { m.remove(); });
  }
  App._dragMarkers = [];
  App._dragPath = null;
  App._dragging = false;
};

// Check if a pixel point is near the route path
App._nearRoute = function(px, threshold) {
  var path = App._dragPath;
  if (!path || path.length < 2) return false;
  for (var i = 0; i < path.length - 1; i++) {
    var a = App.map.latLngToContainerPoint(path[i]);
    var b = App.map.latLngToContainerPoint(path[i + 1]);
    if (App._pointToSegmentDist(px, a, b) <= threshold) return true;
  }
  return false;
};

// Distance from point P to line segment AB (in pixel space)
App._pointToSegmentDist = function(p, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y));
  var t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  var projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) * (p.x - projX) + (p.y - projY) * (p.y - projY));
};

App._rerouteFromDragMarkers = async function() {
  if (App._dragDebounce) clearTimeout(App._dragDebounce);
  App._dragDebounce = setTimeout(async function() {
    var orig = App._dragOrig;
    var dest = App._dragDest;
    var shelters = App._dragShelters;
    var radius = App._dragRadius;

    var waypoints = App._dragMarkers
      .filter(function(m) { return App.map.hasLayer(m); })
      .map(function(m) { return m.getLatLng(); });

    App.setStatus(App.t('statusGettingRoute'), 'info');

    try {
      var newRoute = await App.getRoute(orig, dest, waypoints);
      if (!newRoute) return;

      var analysis = App.analyseRouteCoverage(newRoute.path, shelters, radius);

      // Remove old route polylines (keep markers, circles, endpoints)
      var toKeep = [];
      App.mapObjects.forEach(function(obj) {
        if (obj instanceof L.Polyline && !(obj instanceof L.CircleMarker)) {
          obj.remove();
        } else {
          toKeep.push(obj);
        }
      });
      App.mapObjects = toKeep;

      App.drawRoute(analysis.coveredPolyline, analysis.gapPolylines, analysis.gaps);
      App._dragPath = newRoute.path;

      App.renderScore(analysis.coveredPct, analysis.gaps, newRoute, shelters.length);

      var pctLabel = analysis.coveredPct >= 99
        ? App.t('statusFullCoverage')
        : App.t('statusPartialCoverage')(Math.round(analysis.coveredPct));
      App.setStatus(pctLabel, analysis.coveredPct >= 99 ? 'ok' : analysis.coveredPct >= 70 ? 'info' : 'err');

      clearTimeout(App._dragListTimer);
      App._dragListTimer = setTimeout(async function() {
        await App.renderShelterList(shelters, newRoute.path, radius);
        if (App.isMobile()) App.populateBottomSheet();
      }, 800);

      if (App.isMobile()) App.populateBottomSheet();
    } catch (e) {
      console.warn('Drag re-route failed', e);
    }
  }, 200);
};

App.isPointCovered = function(point, shelters, radius) {
  var effectiveRadius = radius / App.WALK_FACTOR;
  for (var i = 0; i < shelters.length; i++) {
    if (point.distanceTo(shelters[i].location) <= effectiveRadius)
      return true;
  }
  return false;
};
