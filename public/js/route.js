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

// Build candidate corridor routes through shelter-dense areas.
// Strategy: find clusters of shelters that are offset from the direct route,
// then build multi-waypoint routes through chains of those shelters.
App._buildCorridorCandidates = async function(orig, dest, shelters, radius, directRoute) {
  var MAX_DETOUR_RATIO = 1.5;
  var directDist = directRoute.totalDistance;
  var effectiveRadius = radius / App.WALK_FACTOR;

  // 1. Find shelters that are far from the direct route path (potential alternate corridors)
  var offPathShelters = shelters.map(function(s) {
    return { shelter: s, pathDist: App.minDistToPath(s.location, directRoute.path) };
  }).filter(function(x) {
    // Shelters between 150m and 800m from the direct path (not already on it, but not wildly off)
    return x.pathDist > 150 && x.pathDist < 800;
  });

  if (!offPathShelters.length) {
    console.log('[corridor] No off-path shelters found (150-800m from direct route)');
    return [];
  }

  // 2. Cluster off-path shelters by proximity to each other
  // Use a simple greedy clustering: pick a seed, grab all within 400m, repeat
  var unclustered = offPathShelters.slice();
  var clusters = [];
  while (unclustered.length > 0) {
    var seed = unclustered.shift();
    var cluster = [seed];
    var remaining = [];
    for (var i = 0; i < unclustered.length; i++) {
      var inRange = false;
      for (var j = 0; j < cluster.length; j++) {
        if (unclustered[i].shelter.location.distanceTo(cluster[j].shelter.location) <= 400) {
          inRange = true;
          break;
        }
      }
      if (inRange) cluster.push(unclustered[i]);
      else remaining.push(unclustered[i]);
    }
    unclustered = remaining;
    if (cluster.length >= 3) clusters.push(cluster); // only meaningful clusters
  }

  console.log('[corridor] Found ' + clusters.length + ' off-path shelter clusters (3+ shelters each)');

  // 3. For each cluster, build a corridor route using shelters as waypoints
  //    Pick shelters spread along the origin→destination axis
  var candidates = [];
  var maxClusters = Math.min(clusters.length, 3);

  // Sort clusters by size (largest first)
  clusters.sort(function(a, b) { return b.length - a.length; });

  for (var ci = 0; ci < maxClusters; ci++) {
    var cluster = clusters[ci];

    // Order cluster shelters by their projection onto the origin→destination line
    var clusterSorted = cluster.slice().sort(function(a, b) {
      var projA = App._projectOntoLine(a.shelter.location, orig, dest);
      var projB = App._projectOntoLine(b.shelter.location, orig, dest);
      return projA - projB;
    });

    // Pick evenly spaced waypoints along the cluster (max 5)
    var maxWP = Math.min(5, clusterSorted.length);
    var waypoints = [];
    for (var wi = 0; wi < maxWP; wi++) {
      var idx = Math.floor(wi * (clusterSorted.length - 1) / Math.max(maxWP - 1, 1));
      waypoints.push(L.latLng(clusterSorted[idx].shelter.lat, clusterSorted[idx].shelter.lon));
    }

    console.log('[corridor] Cluster ' + ci + ': ' + cluster.length + ' shelters, using ' +
      waypoints.length + ' waypoints');

    try {
      var route = await App.getRoute(orig, dest, waypoints);
      if (route) {
        console.log('[corridor] Cluster ' + ci + ' route: ' + route.totalDistance + 'm (direct: ' + directDist + 'm, ratio: ' + (route.totalDistance / directDist).toFixed(2) + ')');
        if (route.totalDistance <= directDist * MAX_DETOUR_RATIO) {
          candidates.push(route);
        } else {
          console.log('[corridor] Cluster ' + ci + ' rejected: too long');
        }
      }
    } catch (e) {
      console.warn('[corridor] Cluster ' + ci + ' routing failed', e);
    }
  }

  return candidates;
};

// Project a point onto the line from A to B, returning a 0-1 scalar
App._projectOntoLine = function(point, lineA, lineB) {
  var dx = lineB.lng - lineA.lng;
  var dy = lineB.lat - lineA.lat;
  var len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  var t = ((point.lng - lineA.lng) * dx + (point.lat - lineA.lat) * dy) / len2;
  return Math.max(0, Math.min(1, t));
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

  // Evaluate all candidates and pick the one with best coverage
  console.log('[shelter-route] Evaluating ' + baseRouteCandidates.length + ' base route candidates (' +
    (baseRouteCandidates.length - corridorRoutes.length) + ' OSRM + ' + corridorRoutes.length + ' corridor)');
  var baseRoute = directRoute;
  var bestBasePct = 0;
  for (var bi = 0; bi < baseRouteCandidates.length; bi++) {
    var cov = App.analyseRouteCoverage(baseRouteCandidates[bi].path, shelters, radius);
    console.log('[shelter-route] Candidate ' + bi + ': coverage=' + cov.coveredPct + '%, dist=' + baseRouteCandidates[bi].totalDistance + 'm');
    if (cov.coveredPct > bestBasePct) {
      bestBasePct = cov.coveredPct;
      baseRoute = baseRouteCandidates[bi];
    }
  }

  var directCoverage = App.analyseRouteCoverage(baseRoute.path, shelters, radius);
  if (directCoverage.coveredPct >= coverageTarget) {
    return { waypointRoute: baseRoute, usedShelters: [], achievedPct: directCoverage.coveredPct };
  }

  // --- Phase 2: Iterative waypoint optimisation on best base route ---
  var gapPoints = baseRoute.path.filter(function(p) {
    return !App.isPointCovered(p, shelters, radius);
  });

  if (!gapPoints.length) {
    return { waypointRoute: baseRoute, usedShelters: [], achievedPct: 100 };
  }

  var effectiveRadius = radius / App.WALK_FACTOR;
  var directGapDist = directCoverage.gapDist || 0;
  var bestRoute = null;
  var bestGapDist = directGapDist;
  var bestPct = directCoverage.coveredPct;
  var bestShelters = [];
  var usedIds = new Set();
  var selectedShelters = [];

  for (var iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    var currentPath = bestRoute ? bestRoute.path : baseRoute.path;
    var currentGapPoints = currentPath.filter(function(p) { return !App.isPointCovered(p, shelters, radius); });

    if (!currentGapPoints.length || bestPct >= coverageTarget) break;
    if (selectedShelters.length >= MAX_WAYPOINTS) break;

    var candidates = shelters
      .filter(function(s) { return !usedIds.has(s.id); })
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
      var orderedShelters = App.orderWaypointsAlongPath(selectedShelters, baseRoute.path);
      var waypoints = orderedShelters.map(function(s) { return L.latLng(s.lat, s.lon); });
      var wpRoute = await App.getRoute(orig, dest, waypoints);
      if (wpRoute) {
        if (wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO) {
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
      App.setStatus(App.t('statusBestAchievable')(bestPct), 'info');
    }
    return { waypointRoute: bestRoute, usedShelters: bestShelters, achievedPct: bestPct };
  }

  // --- Phase 3: Fallback nearest-shelter approach ---
  var waypointShelterSet = new Set();
  var waypointShelters = [];
  for (var gi = 0; gi < gapPoints.length; gi++) {
    var nearest = null, nearestD = Infinity;
    for (var si = 0; si < shelters.length; si++) {
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
    var orderedFallback = App.orderWaypointsAlongPath(waypointShelters, baseRoute.path);
    var waypoints = orderedFallback.map(function(s) { return L.latLng(s.lat, s.lon); });
    var wpRoute = await App.getRoute(orig, dest, waypoints);
    if (wpRoute && wpRoute.totalDistance > directDist * MAX_DETOUR_RATIO) {
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
  var coveredPct = total > 0 ? Math.round((coveredDist / total) * 100) : 100;

  return { coveredPct: coveredPct, gaps: gaps, coveredPolyline: coveredSegs, gapPolylines: gapSegs, gapDist: Math.round(gapDist) };
};

App.isPointCovered = function(point, shelters, radius) {
  var effectiveRadius = radius / App.WALK_FACTOR;
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
