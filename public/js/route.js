window.App = window.App || {};

App.getRoute = function(origin, destination, waypoints) {
  return new Promise(function(res) {
    var req = {
      origin: origin,
      destination: destination,
      travelMode: google.maps.TravelMode.WALKING,
    };
    if (waypoints && waypoints.length) {
      req.waypoints = waypoints.map(function(w) { return { location: w, stopover: false }; });
      req.optimizeWaypoints = false;
    }
    App.dirSvc.route(req, function(result, status) {
      if (status !== 'OK') {
        App.setStatus('Route error: ' + status, 'err');
        return res(null);
      }
      var leg0 = result.routes[0].legs[0];
      var lastLeg = result.routes[0].legs[result.routes[0].legs.length - 1];
      var allPoints = [];
      result.routes[0].legs.forEach(function(leg) {
        leg.steps.forEach(function(step) {
          var pts = google.maps.geometry.encoding.decodePath(step.polyline.points);
          allPoints = allPoints.concat(pts);
        });
      });
      res({
        result: result,
        path: allPoints,
        distance: leg0.distance.text,
        duration: leg0.duration.text,
        totalDistance: result.routes[0].legs.reduce(function(s, l) { return s + l.distance.value; }, 0),
        totalDuration: result.routes[0].legs.reduce(function(s, l) { return s + l.duration.value; }, 0),
        startLocation: leg0.start_location,
        endLocation: lastLeg.end_location,
      });
    });
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

App.buildShelterRoute = async function(orig, dest, directRoute, shelters, radius) {
  var coverageTarget = 100;
  if (!shelters.length) return { waypointRoute: null, usedShelters: [], achievedPct: 0 };

  var directCoverage = App.analyseRouteCoverage(directRoute.path, shelters, radius);
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
      App.setStatus(App.t('statusBestAchievable')(bestPct), 'info');
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
  var coveredPct = total > 0 ? Math.round((coveredDist / total) * 100) : 100;

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

App.setupDraggableRoute = function(route, shelters, radius) {
  if (App.draggableRenderer) {
    App.draggableRenderer.setMap(null);
    App.draggableRenderer = null;
  }

  App.draggableRenderer = new google.maps.DirectionsRenderer({
    map: App.map,
    directions: route.result,
    draggable: true,
    suppressMarkers: true,
    preserveViewport: true,
    polylineOptions: {
      strokeOpacity: 0,
      strokeWeight: 12,
      zIndex: 10,
    },
  });
  App.mapObjects.push(App.draggableRenderer);

  google.maps.event.addListener(App.draggableRenderer, 'directions_changed', function() {
    var newDirections = App.draggableRenderer.getDirections();
    if (!newDirections || !newDirections.routes || !newDirections.routes[0]) return;

    var allPoints = [];
    newDirections.routes[0].legs.forEach(function(leg) {
      leg.steps.forEach(function(step) {
        var pts = google.maps.geometry.encoding.decodePath(step.polyline.points);
        allPoints = allPoints.concat(pts);
      });
    });

    var totalDistance = newDirections.routes[0].legs.reduce(function(s, l) { return s + l.distance.value; }, 0);
    var totalDuration = newDirections.routes[0].legs.reduce(function(s, l) { return s + l.duration.value; }, 0);

    var draggedRoute = {
      result: newDirections,
      path: allPoints,
      totalDistance: totalDistance,
      totalDuration: totalDuration,
      startLocation: newDirections.routes[0].legs[0].start_location,
      endLocation: newDirections.routes[0].legs[newDirections.routes[0].legs.length - 1].end_location,
    };

    App.reanalyseDraggedRoute(draggedRoute, shelters, radius);
  });
};

App.reanalyseDraggedRoute = function(draggedRoute, shelters, radius) {
  var toKeep = [];
  App.mapObjects.forEach(function(obj) {
    if (obj instanceof google.maps.Polyline && obj !== App.draggableRenderer) {
      obj.setMap(null);
    } else {
      toKeep.push(obj);
    }
  });
  App.mapObjects = toKeep;

  var result = App.analyseRouteCoverage(draggedRoute.path, shelters, radius);

  App.drawRoute(result.coveredPolyline, result.gapPolylines);

  App.renderScore(result.coveredPct, result.gaps, draggedRoute, shelters.length);
  App.renderGaps(result.gaps);

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
