window.App = window.App || {};

App._formatDistance = function(meters) {
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m';
};

App._formatDuration = function(seconds) {
  var mins = Math.round(seconds / 60);
  if (mins < 60) return mins + ' min';
  return Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min';
};

App._parseOsrmRoute = function(route) {
  var allPoints = route.geometry.coordinates.map(function(c) {
    return L.latLng(c[1], c[0]);
  });
  return {
    path: allPoints,
    distance: App._formatDistance(route.distance),
    duration: App._formatDuration(route.duration),
    totalDistance: Math.round(route.distance),
    totalDuration: Math.round(route.duration),
    startLocation: allPoints[0],
    endLocation: allPoints[allPoints.length - 1],
  };
};

App.getRoute = function(origin, destination, waypoints, options) {
  // Build OSRM coordinate string: lng,lat;lng,lat;...
  var coords = [];
  coords.push(origin.lng + ',' + origin.lat);
  if (waypoints && waypoints.length) {
    waypoints.forEach(function(w) {
      coords.push(w.lng + ',' + w.lat);
    });
  }
  coords.push(destination.lng + ',' + destination.lat);

  var alternatives = (options && options.alternatives) ? '&alternatives=true' : '';
  var url = 'https://router.project-osrm.org/route/v1/foot/' + coords.join(';') +
    '?overview=full&geometries=geojson&steps=true' + alternatives;

  return fetch(url)
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
        App.setStatus('Route error: ' + (data.code || 'no route found'), 'err');
        return null;
      }

      if (options && options.alternatives) {
        return data.routes.map(App._parseOsrmRoute);
      }

      return App._parseOsrmRoute(data.routes[0]);
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

// Build shelter-hopping chains from origin to destination using beam search.
// Keeps the top beamWidth partial chains at each step so we explore multiple
// corridors instead of committing to one greedy path.
App._buildShelterChainBeam = function(orig, dest, shelters, maxEdge, beamWidth) {
  beamWidth = beamWidth || 3;
  var straightLineDist = orig.distanceTo(dest);
  var maxSteps = Math.min(20, Math.ceil(straightLineDist / (maxEdge * 0.5)));
  var maxChainDist = straightLineDist * 1.5;

  // Each beam entry: { current, chain, used, chainDist }
  var beams = [{ current: orig, chain: [], used: new Set(), chainDist: 0 }];

  for (var step = 0; step < maxSteps; step++) {
    var nextBeams = [];

    for (var bi = 0; bi < beams.length; bi++) {
      var beam = beams[bi];
      var distToTarget = beam.current.distanceTo(dest);

      // This beam can reach destination directly — keep it as-is
      if (distToTarget <= maxEdge) {
        nextBeams.push(beam);
        continue;
      }

      // Find top candidates for this beam
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

      // Expand the top few candidates for this beam
      var expandCount = Math.min(beamWidth, candidates.length);
      if (expandCount === 0) {
        nextBeams.push(beam); // dead end — keep as-is
        continue;
      }

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

    // Score each beam by chain length (more shelters = more coverage potential)
    // and closeness to destination, then keep top beamWidth * 2
    nextBeams.sort(function(a, b) {
      var aDist = a.current.distanceTo(dest);
      var bDist = b.current.distanceTo(dest);
      var aScore = a.chain.length * 100 - aDist;
      var bScore = b.chain.length * 100 - bDist;
      return bScore - aScore;
    });
    beams = nextBeams.slice(0, beamWidth * 2);
  }

  return beams;
};

// Generate corridor candidate routes by building shelter-hopping chains
// at different maxEdge distances in both directions, then routing via OSRM.
App._buildCorridorCandidates = async function(orig, dest, shelters, radius, directRoute) {
  var MAX_DETOUR_RATIO = 1.5;
  var directDist = directRoute.totalDistance;
  var effectiveRadius = radius * App.WALK_FACTOR;

  var edgeDistances = [
    effectiveRadius * 1.5,
    effectiveRadius * 2.5,
    effectiveRadius * 4,
  ];

  // Collect unique chains from beam search in both directions
  var allChains = [];
  var seenChainKeys = new Set();

  for (var ei = 0; ei < edgeDistances.length; ei++) {
    var maxEdge = edgeDistances[ei];

    // Forward: orig → dest
    var forwardBeams = App._buildShelterChainBeam(orig, dest, shelters, maxEdge, 3);
    for (var fi = 0; fi < forwardBeams.length; fi++) {
      var chain = forwardBeams[fi].chain;
      if (chain.length < 2) continue;
      var key = chain.map(function(s) { return s.id; }).join(',');
      if (!seenChainKeys.has(key)) {
        seenChainKeys.add(key);
        allChains.push(chain);
      }
    }

    // Reverse: dest → orig, then flip the chain
    var reverseBeams = App._buildShelterChainBeam(dest, orig, shelters, maxEdge, 3);
    for (var ri = 0; ri < reverseBeams.length; ri++) {
      var rchain = reverseBeams[ri].chain.slice().reverse();
      if (rchain.length < 2) continue;
      var rkey = rchain.map(function(s) { return s.id; }).join(',');
      if (!seenChainKeys.has(rkey)) {
        seenChainKeys.add(rkey);
        allChains.push(rchain);
      }
    }
  }

  // Route each unique chain through OSRM
  var candidates = [];
  for (var ci = 0; ci < allChains.length; ci++) {
    var waypoints = allChains[ci].map(function(s) { return L.latLng(s.lat, s.lon); });
    try {
      var route = await App.getRoute(orig, dest, waypoints);
      if (route && route.totalDistance <= directDist * MAX_DETOUR_RATIO) {
        candidates.push(route);
      }
    } catch (e) {
      console.warn('[corridor] Chain routing failed', e);
    }
  }

  return candidates;
};

App.buildShelterRoute = async function(orig, dest, directRoute, shelters, radius) {
  var coverageTarget = 100;
  if (!shelters.length) return { waypointRoute: null, usedShelters: [], achievedPct: 0 };

  var MAX_WAYPOINTS = 23;
  var MAX_ITERATIONS = 3;
  var MAX_DETOUR_RATIO = 1.5;
  var directDist = directRoute.totalDistance;

  // --- Phase 1: Pick the best base route ---
  // Gather candidates: OSRM alternatives + shelter-density corridors
  var baseRouteCandidates = [directRoute];
  if (directRoute._alternatives && directRoute._alternatives.length) {
    baseRouteCandidates = baseRouteCandidates.concat(directRoute._alternatives);
  }

  App.setStatus(App.t('statusOptimising') || 'Optimising route…', 'info');

  // Generate corridor candidates through shelter-dense areas
  var corridorRoutes = await App._buildCorridorCandidates(orig, dest, shelters, radius, directRoute);
  baseRouteCandidates = baseRouteCandidates.concat(corridorRoutes);

  // Evaluate all candidates and pick the one with best coverage-per-distance
  var baseRoute = directRoute;
  var bestBaseScore = -Infinity;
  var directCov = App.analyseRouteCoverage(directRoute.path, shelters, radius);
  for (var bi = 0; bi < baseRouteCandidates.length; bi++) {
    var candidate = baseRouteCandidates[bi];
    var cov = App.analyseRouteCoverage(candidate.path, shelters, radius);
    // Score: coverage percentage, penalised by distance increase over direct route.
    // A route 1.3x longer needs substantially better coverage to win.
    var distRatio = candidate.totalDistance / directDist;
    var distPenalty = Math.max(0, (distRatio - 1)) * 40; // 40% coverage penalty per 1x distance increase
    var score = cov.coveredPct - distPenalty;
    if (score > bestBaseScore) {
      bestBaseScore = score;
      baseRoute = candidate;
    }
  }

  var directCoverage = App.analyseRouteCoverage(baseRoute.path, shelters, radius);
  if (directCoverage.coveredPct >= coverageTarget) {
    return { waypointRoute: baseRoute, usedShelters: [], achievedPct: directCoverage.coveredPct };
  }

  // --- Phase 2: Targeted gap sub-routing ---
  // Instead of dumping all gap-covering shelters as waypoints at once,
  // identify the largest gaps and fix them one at a time with a single
  // well-chosen waypoint per gap.
  var effectiveRadius = radius * App.WALK_FACTOR;
  var currentRoute = baseRoute;
  var currentCoverage = directCoverage;
  var allWaypoints = [];
  var MAX_GAP_FIXES = 5;

  for (var gapIter = 0; gapIter < MAX_GAP_FIXES; gapIter++) {
    if (currentCoverage.coveredPct >= coverageTarget) break;
    if (allWaypoints.length >= MAX_WAYPOINTS) break;

    // Find the largest remaining gap
    var gaps = currentCoverage.gaps || [];
    if (!gaps.length) break;

    gaps.sort(function(a, b) { return b.distMeters - a.distMeters; });
    var largestGap = gaps[0];
    if (largestGap.distMeters < 50) break; // not worth fixing tiny gaps

    // Find the midpoint of the gap
    var gapMid = largestGap.points[Math.floor(largestGap.points.length / 2)];

    // Find the best shelter to pull the route toward this gap area.
    // Pick the shelter closest to the gap midpoint that would actually
    // provide coverage (within effectiveRadius * 2 of the gap).
    var bestShelter = null;
    var bestDist = Infinity;
    for (var si = 0; si < shelters.length; si++) {
      var s = shelters[si];
      var d = gapMid.distanceTo(s.location);
      if (d < bestDist && d < effectiveRadius * 2) {
        bestDist = d;
        bestShelter = s;
      }
    }

    if (!bestShelter) break;

    allWaypoints.push(bestShelter);

    App.setStatus(App.t('statusRoutingWaypoints')(gapIter + 1, allWaypoints.length), 'info');

    try {
      var orderedWaypoints = App.orderWaypointsAlongPath(allWaypoints, baseRoute.path);
      var wpLatLngs = orderedWaypoints.map(function(s) { return L.latLng(s.lat, s.lon); });
      var wpRoute = await App.getRoute(orig, dest, wpLatLngs);
      if (!wpRoute) break;

      if (wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO) {
        allWaypoints.pop(); // revert this waypoint
        break;
      }

      var newCoverage = App.analyseRouteCoverage(wpRoute.path, shelters, radius);
      if ((newCoverage.gapDist || 0) < (currentCoverage.gapDist || 0)) {
        currentRoute = wpRoute;
        currentCoverage = newCoverage;
      } else {
        allWaypoints.pop(); // didn't help, revert
        break;
      }
    } catch (e) {
      console.warn('Gap fix iteration ' + (gapIter + 1) + ' failed', e);
      allWaypoints.pop();
      break;
    }
  }

  if (currentRoute !== directRoute || currentCoverage.coveredPct > directCov.coveredPct) {
    if (currentCoverage.coveredPct < coverageTarget) {
      App.setStatus(App.t('statusBestAchievable')(currentCoverage.coveredPct), 'info');
    }
    return { waypointRoute: currentRoute, usedShelters: allWaypoints, achievedPct: currentCoverage.coveredPct };
  }

  return { waypointRoute: null, usedShelters: [], achievedPct: directCoverage.coveredPct };
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
  var coveredPct = total > 0 ? Math.round((coveredDist / total) * 100) : 100;

  return { coveredPct: coveredPct, gaps: gaps, coveredPolyline: coveredSegs, gapPolylines: gapSegs, gapDist: Math.round(gapDist) };
};

App.isPointCovered = function(point, shelters, radius) {
  var effectiveRadius = radius * App.WALK_FACTOR;
  for (var i = 0; i < shelters.length; i++) {
    if (point.distanceTo(shelters[i].location) <= effectiveRadius)
      return true;
  }
  return false;
};

App.setupDraggableRoute = function(route, shelters, radius) {
  // Remove old interactive elements
  if (App._interactivePolyline) {
    if (App.map.hasLayer(App._interactivePolyline)) App.map.removeLayer(App._interactivePolyline);
    App._interactivePolyline = null;
  }
  if (App._routeWaypoints) {
    App._routeWaypoints.forEach(function(wp) { if (App.map.hasLayer(wp)) App.map.removeLayer(wp); });
  }
  App._routeWaypoints = [];
  App._dragRouteData = {
    origin: route.startLocation,
    destination: route.endLocation,
    shelters: shelters,
    radius: radius,
  };

  // Add a wider transparent polyline for click-to-add-waypoint interaction
  App._interactivePolyline = L.polyline(route.path, {
    color: '#1A4DE8',
    weight: 20,
    opacity: 0.0001,
    interactive: true,
  }).addTo(App.map);
  App.mapObjects.push(App._interactivePolyline);

  App._interactivePolyline.on('click', function(e) {
    L.DomEvent.stopPropagation(e);
    var icon = L.divIcon({
      className: 'route-waypoint-icon',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      html: '<div style="width:16px;height:16px;border-radius:50%;background:#1A4DE8;border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:grab"></div>',
    });
    var wp = L.marker(e.latlng, {
      draggable: true,
      icon: icon,
      zIndexOffset: 1000,
    }).addTo(App.map);

    App._routeWaypoints.push(wp);

    wp.on('dragend', function() {
      App._rerouteFromWaypoints();
    });

    wp.on('contextmenu', function() {
      App.map.removeLayer(wp);
      App._routeWaypoints = App._routeWaypoints.filter(function(w) { return w !== wp; });
      App._rerouteFromWaypoints();
    });

    App._rerouteFromWaypoints();
  });
};

App._rerouteFromWaypoints = async function() {
  var data = App._dragRouteData;
  if (!data) return;

  // Order waypoints along the current path by their position
  var waypoints = App._routeWaypoints.map(function(wp) { return wp.getLatLng(); });

  var route = await App.getRoute(data.origin, data.destination, waypoints);
  if (!route) return;

  // Update interactive polyline path
  if (App._interactivePolyline) {
    App._interactivePolyline.setLatLngs(route.path);
  }

  App.reanalyseDraggedRoute(route, data.shelters, data.radius);
};

App.reanalyseDraggedRoute = function(draggedRoute, shelters, radius) {
  // Remove old route polylines only
  var toKeep = [];
  App.mapObjects.forEach(function(obj) {
    if (obj._isRoutePolyline) {
      if (App.map.hasLayer(obj)) App.map.removeLayer(obj);
    } else {
      toKeep.push(obj);
    }
  });
  App.mapObjects = toKeep;

  var result = App.analyseRouteCoverage(draggedRoute.path, shelters, radius);

  App.drawRoute(result.coveredPolyline, result.gapPolylines, result.gaps);

  App.renderScore(result.coveredPct, result.gaps, draggedRoute, shelters.length);

  var pctLabel = result.coveredPct >= 99
    ? App.t('statusFullCoverage')
    : App.t('statusPartialCoverage')(result.coveredPct);
  App.setStatus(pctLabel, result.coveredPct >= 99 ? 'ok' : result.coveredPct >= 70 ? 'info' : 'err');

  clearTimeout(App.shelterListUpdateTimer);
  App.shelterListUpdateTimer = setTimeout(async function() {
    await App.renderShelterList(shelters, draggedRoute.path, radius);
    if (App.isMobile()) App.populateBottomSheet();
  }, 800);

  if (App.isMobile()) App.populateBottomSheet();
};
