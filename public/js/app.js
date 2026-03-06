window.App = window.App || {};

// Shared state
App.map = null;
App.mapsReady = false;
App.mapObjects = [];
App.shelterCircles = [];
App.shelterRatings = {};
App.geoLocations = { origin: null, dest: null };
App.detectedCity = null;
App.detectedCities = [];

// Global aliases for HTML onclick handlers
window.run = function() { App.run(); };
window.loadExample = function(id) { App.loadExample(id); };
window.useMyLocation = function(id) { App.useMyLocation(id); };
window.swapLocations = function() { App.swapLocations(); };
window.setLang = function(lang) { App.setLang(lang); };
window.submitReview = function(id, btn) { App.submitReview(id, btn); };
window.startAddMiklat = function() { App.startAddMiklat(); };
window.cancelAddMiklat = function() { App.cancelAddMiklat(); };
window.saveCommunityMiklat = function() { App.saveCommunityMiklat(); };
window.shareRoute = function(e) { App.shareRoute(e); };
window.exportPDF = function() { App.exportPDF(); };

App.useMyLocation = function(fieldId) {
  if (!navigator.geolocation) {
    return App.setStatus(App.t('geoNotSupported'), 'err');
  }
  var mobileMap = { mobileOrigin: 'origin', mobileDest: 'dest' };
  var canonicalId = mobileMap[fieldId] || fieldId;
  var pairedId = mobileMap[fieldId] ? fieldId : (canonicalId === 'origin' ? 'mobileOrigin' : 'mobileDest');

  var input = document.getElementById(fieldId);
  var paired = document.getElementById(pairedId);
  var btn = input.parentElement.querySelector('.loc-btn');
  input.value = App.t('locating');
  input.disabled = true;
  if (paired) { paired.value = App.t('locating'); }

  function onSuccess(pos) {
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    App.geoLocations[canonicalId] = { lat: lat, lng: lng };
    input.value = App.t('myLocation');
    input.disabled = false;
    btn.classList.add('active');
    if (paired) {
      paired.value = App.t('myLocation');
      var pBtn = paired.parentElement.querySelector('.loc-btn');
      if (pBtn) pBtn.classList.add('active');
    }
    if (canonicalId === 'origin') {
      var chip = document.getElementById('mobileOriginChip');
      if (chip) chip.classList.add('active');
    }
  }
  function onError(err) {
    input.value = '';
    input.disabled = false;
    App.geoLocations[canonicalId] = null;
    btn.classList.remove('active');
    if (paired) {
      paired.value = '';
      var pBtn = paired.parentElement.querySelector('.loc-btn');
      if (pBtn) pBtn.classList.remove('active');
    }
    if (canonicalId === 'origin') {
      var chip = document.getElementById('mobileOriginChip');
      if (chip) chip.classList.remove('active');
    }
    App.setStatus(App.t('geoError' + err.code) || App.t('geoErrorGeneric'), 'err');
    if (err.code === 1 && !App._permRetried) { App.watchPermissionChange(fieldId); }
    App._permRetried = false;
  }
  navigator.geolocation.getCurrentPosition(
    onSuccess,
    function(err) {
      if (err.code === 3) {
        navigator.geolocation.getCurrentPosition(
          onSuccess, onError,
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
        );
      } else {
        onError(err);
      }
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
};

App.watchPermissionChange = function(fieldId) {
  if (App._permWatcher || !navigator.permissions) return;
  navigator.permissions.query({ name: 'geolocation' }).then(function(status) {
    if (status.state === 'granted') return;
    App._permWatcher = status;
    status.onchange = function() {
      if (status.state === 'granted') {
        status.onchange = null;
        App._permWatcher = null;
        App._permRetried = true;
        App.useMyLocation(fieldId);
      }
    };
  }).catch(function() {});
};

App.swapLocations = function() {
  document.querySelectorAll('.swap-btn').forEach(function(btn) {
    btn.classList.toggle('rotated');
  });
  var originEl = document.getElementById('origin');
  var destEl = document.getElementById('dest');
  var mOriginEl = document.getElementById('mobileOrigin');
  var mDestEl = document.getElementById('mobileDest');

  var tmpVal = originEl.value;
  originEl.value = destEl.value;
  destEl.value = tmpVal;
  if (mOriginEl && mDestEl) {
    mOriginEl.value = originEl.value;
    mDestEl.value = destEl.value;
  }

  var tmpGeo = App.geoLocations.origin;
  App.geoLocations.origin = App.geoLocations.dest;
  App.geoLocations.dest = tmpGeo;

  var originBtn = originEl.parentElement.querySelector('.loc-btn');
  var destBtn = destEl.parentElement.querySelector('.loc-btn');
  if (originBtn && destBtn) {
    var tmpActive = originBtn.classList.contains('active');
    originBtn.classList.toggle('active', destBtn.classList.contains('active'));
    destBtn.classList.toggle('active', tmpActive);
  }

  if (mOriginEl && mDestEl) {
    var mOriginBtn = mOriginEl.parentElement.querySelector('.loc-btn');
    var mDestBtn = mDestEl.parentElement.querySelector('.loc-btn');
    if (mOriginBtn && mDestBtn) {
      var tmpActive = mOriginBtn.classList.contains('active');
      mOriginBtn.classList.toggle('active', mDestBtn.classList.contains('active'));
      mDestBtn.classList.toggle('active', tmpActive);
    }
  }

  var chip = document.getElementById('mobileOriginChip');
  if (chip) chip.classList.toggle('active', !!App.geoLocations.origin);
};

App._runId = 0;

App.run = async function() {
  var runId = ++App._runId;
  if (App.isMobile()) App.syncInputs();

  var origText = document.getElementById('origin').value.trim();
  var destText = document.getElementById('dest').value.trim();
  var radius = parseInt(document.getElementById('radius').value);

  if (!origText || !destText) {
    App.setStatus(App.t('statusEnterBoth'), 'err');
    if (App.isMobile()) App.setMobileStatus(App.t('statusEnterBoth'), 'err');
    return;
  }

  if (App.isMobile()) {
    if (document.activeElement) document.activeElement.blur();
    App.setSheetPosition('peek');
  }

  App.setBusy(true);
  try {
    if (!App.mapsReady) {
      App.setStatus(App.t('statusLoadingMaps'), 'info');
      App.initMap();
    }

    var origCoords = App.geoLocations.origin;
    if (!origCoords) {
      App.setStatus(App.t('statusGeocoding'), 'info');
      origCoords = await App.geocode(origText);
      if (!origCoords) { App.setStatus(App.t('statusGeocodeFailed'), 'err'); App.setBusy(false); return; }
    }
    var destCoords = App.geoLocations.dest;
    if (!destCoords) {
      App.setStatus(App.t('statusGeocoding'), 'info');
      destCoords = await App.geocode(destText);
      if (!destCoords) { App.setStatus(App.t('statusGeocodeFailed'), 'err'); App.setBusy(false); return; }
    }
    var orig = L.latLng(origCoords.lat, origCoords.lng);
    var dest = L.latLng(destCoords.lat, destCoords.lng);

    App.clearAll();
    App.setStatus(App.t('statusGettingRoute'), 'info');

    var directRoute = await App.getRoute(orig, dest, null, { alternates: 5 });
    if (!directRoute) return;
    if (runId !== App._runId) return;

    // If the primary Valhalla route overshoots, try without alternatives
    if (App._routeOvershoots(directRoute.path, orig, dest)) {
      console.warn('Primary route overshoots, retrying without alternatives');
      var simpleRoute = await App.getRoute(orig, dest);
      if (simpleRoute && !App._routeOvershoots(simpleRoute.path, orig, dest)) {
        directRoute = simpleRoute;
      }
    }

    var bbox = App.getPathBbox(directRoute.path, 0.012);
    var cities = App.detectCities(directRoute.path);
    var cityNames = cities.map(function(c) { return App.currentLang === 'he' ? c.nameHe : c.name; });
    App.setStatus(App.t('statusFetchingShelters')(cityNames.join(', ')), 'info');
    var shelters = await App.fetchShelters(bbox, directRoute.path);
    var dataSrcEl = document.getElementById('dataSrc');
    if (dataSrcEl && App.detectedCities && App.detectedCities.length) {
      dataSrcEl.textContent = 'Data: ' + App.detectedCities.map(function(c) { return c.nameHe; }).join(', ') + ' \u2014 GIS';
    }
    App.setStatus(App.t('statusFoundShelters')(shelters.length), 'info');

    var buildResult = await App.buildShelterRoute(
      orig, dest, directRoute, shelters, radius
    );
    var finalRoute = buildResult.waypointRoute || directRoute;

    // Reject any route that overshoots beyond origin or destination
    if (App._routeOvershoots(finalRoute.path, orig, dest)) {
      console.warn('Route overshoots O-D endpoints, falling back to direct route');
      finalRoute = directRoute;
      buildResult = { waypointRoute: null, usedShelters: [], achievedPct: 0 };
    }

    var analysis = App.analyseRouteCoverage(finalRoute.path, shelters, radius);

    App.drawRoute(analysis.coveredPolyline, analysis.gapPolylines, analysis.gaps);
    App.drawShelterCircles(shelters, radius / App.WALK_FACTOR);
    App.drawShelterMarkers(shelters, buildResult.usedShelters);
    App.drawEndpoints(finalRoute);
    App.fitAll(finalRoute, shelters);
    App.setupDraggableRoute(orig, dest, finalRoute, shelters, radius);

    App.lastRouteShare = {
      startLocation: finalRoute.startLocation,
      endLocation: finalRoute.endLocation,
      waypoints: buildResult.usedShelters,
      coveragePct: analysis.coveredPct,
      radius: radius,
      maneuvers: finalRoute.maneuvers || [],
      totalDistance: finalRoute.totalDistance,
      totalDuration: finalRoute.totalDuration,
    };

    App.renderScore(analysis.coveredPct, analysis.gaps, finalRoute, shelters.length);
    document.getElementById('shareRow').style.display = '';
    App.setStatus(App.t('statusCalcWalk'), 'info');
    var nearby = await App.renderShelterList(shelters, finalRoute.path, radius);
    App.fetchAndDisplayRatings((nearby || []).map(function(s) { return s.id; }));

    document.getElementById('legend').classList.add('show');
    document.getElementById('emptyState').style.display = 'none';
    App.showFirstRunTip();

    var pctLabel = analysis.coveredPct >= 99
      ? App.t('statusFullCoverage')
      : App.t('statusPartialCoverage')(Math.round(analysis.coveredPct));
    App.setStatus(pctLabel, analysis.coveredPct >= 99 ? 'ok' : analysis.coveredPct >= 70 ? 'info' : 'err');

    if (App.isMobile()) {
      App.populateBottomSheet();
      App.setSheetPosition('peek');
    }

  } catch(e) {
    console.error(e);
    App.setStatus(e.message, 'err');
  } finally {
    App.setBusy(false);
  }
};

App.EXAMPLES = {
  tlv: {
    origin: { en: 'Dizengoff Center, Tel Aviv', he: '\u05de\u05e8\u05db\u05d6 \u05d3\u05d9\u05d6\u05e0\u05d2\u05d5\u05e3, \u05ea\u05dc \u05d0\u05d1\u05d9\u05d1' },
    dest:   { en: 'Rothschild Boulevard 1, Tel Aviv', he: '\u05e9\u05d3\u05e8\u05d5\u05ea \u05e8\u05d5\u05d8\u05e9\u05d9\u05dc\u05d3 1, \u05ea\u05dc \u05d0\u05d1\u05d9\u05d1' },
  },
  jer: {
    origin: { en: 'Jaffa Gate, Jerusalem', he: '\u05e9\u05e2\u05e8 \u05d9\u05e4\u05d5, \u05d9\u05e8\u05d5\u05e9\u05dc\u05d9\u05dd' },
    dest:   { en: 'Mahane Yehuda Market, Jerusalem', he: '\u05e9\u05d5\u05e7 \u05de\u05d7\u05e0\u05d4 \u05d9\u05d4\u05d5\u05d3\u05d4, \u05d9\u05e8\u05d5\u05e9\u05dc\u05d9\u05dd' },
  },
  haifa: {
    origin: { en: 'Carmel Center, Haifa', he: '\u05de\u05e8\u05db\u05d6 \u05d4\u05db\u05e8\u05de\u05dc, \u05d7\u05d9\u05e4\u05d4' },
    dest:   { en: 'Haifa Port', he: '\u05e0\u05de\u05dc \u05d7\u05d9\u05e4\u05d4' },
  },
};

App.loadExample = function(id) {
  var ex = App.EXAMPLES[id];
  if (!ex) return;
  var lang = App.currentLang;
  var originVal = ex.origin[lang] || ex.origin.en;
  var destVal = ex.dest[lang] || ex.dest.en;

  document.getElementById('origin').value = originVal;
  document.getElementById('dest').value = destVal;
  App.geoLocations.origin = null;
  App.geoLocations.dest = null;

  var mo = document.getElementById('mobileOrigin');
  var md = document.getElementById('mobileDest');
  if (mo) mo.value = originVal;
  if (md) md.value = destVal;

  App.run();
};

App.showFirstRunTip = function() {
  if (localStorage.getItem('miklat-firstrun-seen')) return;
  localStorage.setItem('miklat-firstrun-seen', '1');

  var tip = document.createElement('div');
  tip.className = 'first-run-tip';
  tip.innerHTML =
    '<div class="first-run-tip-text">' + App.t('firstRunTip') + '</div>' +
    '<button class="first-run-tip-dismiss">' + App.t('firstRunDismiss') + '</button>';
  tip.querySelector('.first-run-tip-dismiss').addEventListener('click', function() {
    tip.classList.add('out');
    setTimeout(function() { tip.remove(); }, 300);
  });

  var mapWrap = document.querySelector('.map-wrap');
  if (mapWrap) mapWrap.appendChild(tip);

  setTimeout(function() {
    if (tip.parentNode) {
      tip.classList.add('out');
      setTimeout(function() { tip.remove(); }, 300);
    }
  }, 12000);
};

// Share state
App.lastRouteShare = null;

App.buildShareUrl = function() {
  var share = App.lastRouteShare;
  if (!share) return null;
  var params = new URLSearchParams({
    olat: share.startLocation.lat.toFixed(6),
    olng: share.startLocation.lng.toFixed(6),
    dlat: share.endLocation.lat.toFixed(6),
    dlng: share.endLocation.lng.toFixed(6),
    r: share.radius,
  });
  return window.location.origin + window.location.pathname + '?' + params.toString();
};

App.shareRoute = function(e) {
  var url = App.buildShareUrl();
  if (!url) return;

  var share = App.lastRouteShare;
  var title = App.t('shareTitle')(share.coveragePct);
  var text = App.t('shareText');

  // Native share on mobile only
  if (App.isMobile() && navigator.share) {
    navigator.share({ title: title, text: text, url: url }).catch(function() {});
    return;
  }

  // Copy to clipboard on desktop
  var clickedBtn = e && e.target ? e.target.closest('.share-btn') : null;
  if (!navigator.clipboard) { window.open(url, '_blank', 'noopener'); return; }
  navigator.clipboard.writeText(url).then(function() {
    var span = clickedBtn ? clickedBtn.querySelector('span') : document.querySelector('#shareRow .share-btn--copy span');
    if (!span) return;
    var origText = span.textContent;
    span.textContent = App.t('shareLinkCopied');
    setTimeout(function() { span.textContent = origText; }, 2000);
  }).catch(function() {
    window.open(url, '_blank', 'noopener');
  });
};

// PDF export

App.exportPDF = async function() {
  var share = App.lastRouteShare;
  if (!share) return;

  var btn = document.querySelector('.share-btn--pdf');
  var btnSpan = btn ? btn.querySelector('span') : null;
  if (btnSpan) btnSpan.textContent = App.t('exportingPDF');

  try {
    var params = new URLSearchParams({
      olat: share.startLocation.lat.toFixed(6),
      olng: share.startLocation.lng.toFixed(6),
      dlat: share.endLocation.lat.toFixed(6),
      dlng: share.endLocation.lng.toFixed(6),
      r: share.radius,
    });
    var resp = await fetch('/api/pdf?' + params.toString());
    if (!resp.ok) throw new Error('PDF generation failed (' + resp.status + ')');
    var blob = await resp.blob();
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'miklat-route.pdf';
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error('PDF export failed:', err);
    App.setStatus(App.t('exportPDFFailed') || 'PDF export failed', 'err');
  } finally {
    if (btnSpan) btnSpan.textContent = App.t('exportPDF');
  }
};

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
  var fieldPairs = { origin: 'mobileOrigin', dest: 'mobileDest', mobileOrigin: 'origin', mobileDest: 'dest' };
  ['origin', 'dest', 'mobileOrigin', 'mobileDest'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var canonicalId = { mobileOrigin: 'origin', mobileDest: 'dest' }[id] || id;
    el.addEventListener('input', function() {
      App.geoLocations[canonicalId] = null;
      var btn = el.parentElement.querySelector('.loc-btn');
      if (btn) btn.classList.remove('active');
      var pairedEl = document.getElementById(fieldPairs[id]);
      if (pairedEl) {
        var pBtn = pairedEl.parentElement.querySelector('.loc-btn');
        if (pBtn) pBtn.classList.remove('active');
      }
      if (canonicalId === 'origin') {
        var chip = document.getElementById('mobileOriginChip');
        if (chip) chip.classList.remove('active');
      }
    });
  });

  // Shelter radius toggle sync
  function toggleShelterCircles(visible) {
    App.shelterCircles.forEach(function(c) {
      if (visible) { if (!App.map.hasLayer(c)) c.addTo(App.map); }
      else { c.remove(); }
    });
  }
  var srToggle = document.getElementById('showRadius');
  var mSrToggle = document.getElementById('mobileShowRadius');
  if (srToggle) {
    srToggle.addEventListener('change', function() {
      if (mSrToggle) mSrToggle.checked = srToggle.checked;
      toggleShelterCircles(srToggle.checked);
    });
  }
  if (mSrToggle) {
    mSrToggle.addEventListener('change', function() {
      if (srToggle) srToggle.checked = mSrToggle.checked;
      toggleShelterCircles(mSrToggle.checked);
    });
  }

  // Community toggle sync
  var commToggle = document.getElementById('includeCommunity');
  var mCommToggle = document.getElementById('mobileIncludeCommunity');
  if (commToggle) {
    commToggle.addEventListener('change', function() {
      if (mCommToggle) mCommToggle.checked = commToggle.checked;
    });
  }
  if (mCommToggle) {
    mCommToggle.addEventListener('change', function() {
      if (commToggle) commToggle.checked = mCommToggle.checked;
    });
  }

  // Mobile init
  if (App.isMobile()) {
    App.initBottomSheet();
    App.initMobileSettings();
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var tag = e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.target.closest('.community-form') || e.target.closest('.review-form')) return;
  App.run();
});

window.addEventListener('resize', function() {
  if (App.isMobile() && App.sheetState !== 'hidden') {
    App.setSheetPosition(App.sheetState);
  }
});

// Init language from saved preference
App.setLang(localStorage.getItem('miklat-lang') || 'en');

// Auto-run from shared URL params
(function() {
  var params = new URLSearchParams(window.location.search);
  var olat = parseFloat(params.get('olat'));
  var olng = parseFloat(params.get('olng'));
  var dlat = parseFloat(params.get('dlat'));
  var dlng = parseFloat(params.get('dlng'));
  if (isNaN(olat) || isNaN(olng) || isNaN(dlat) || isNaN(dlng)) return;

  var r = parseInt(params.get('r'));
  if (!isNaN(r)) {
    document.getElementById('radius').value = r;
    var mr = document.getElementById('mobileRadius');
    if (mr) mr.value = r;
  }

  // Reverse-geocode to fill in address fields, then run
  App.geoLocations.origin = { lat: olat, lng: olng };
  App.geoLocations.dest = { lat: dlat, lng: dlng };

  Promise.all([
    App.nominatimReverse(olat, olng),
    App.nominatimReverse(dlat, dlng),
  ]).then(function(names) {
    var origName = names[0] || (olat.toFixed(5) + ', ' + olng.toFixed(5));
    var destName = names[1] || (dlat.toFixed(5) + ', ' + dlng.toFixed(5));
    document.getElementById('origin').value = origName;
    document.getElementById('dest').value = destName;
    var mo = document.getElementById('mobileOrigin');
    var md = document.getElementById('mobileDest');
    if (mo) mo.value = origName;
    if (md) md.value = destName;
    // Clean the URL so it doesn't re-trigger on refresh after user changes inputs
    history.replaceState(null, '', window.location.pathname);
    App.run();
  });
})();

// Load map eagerly so user sees Israel immediately
App.initMap();
