window.App = window.App || {};

// Shared state
App.map = null;
App.dirSvc = null;
App.dirRenderer = null;
App.mapsReady = false;
App.mapObjects = [];
App.shelterCircles = [];
App.shelterRatings = {};
App.geoLocations = { origin: null, dest: null };
App.draggableRenderer = null;
App.shelterListUpdateTimer = null;
App.detectedCity = null;

// Global aliases for HTML onclick handlers
window.run = function() { App.run(); };
window.useMyLocation = function(id) { App.useMyLocation(id); };
window.swapLocations = function() { App.swapLocations(); };
window.setLang = function(lang) { App.setLang(lang); };
window.submitReview = function(id, btn) { App.submitReview(id, btn); };

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
    var msgs = {
      1: 'Location access denied. Please allow location access in your browser settings.',
      2: 'Could not determine your location. Please try again.',
      3: 'Location request timed out. Please try again.',
    };
    App.setStatus(msgs[err.code] || 'Could not get your location.', 'err');
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

App.swapLocations = function() {
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

App.run = async function() {
  if (App.isMobile()) App.syncInputs();

  var origText = document.getElementById('origin').value.trim();
  var destText = document.getElementById('dest').value.trim();
  var radius = parseInt(document.getElementById('radius').value);
  var coverageTarget = parseInt(document.getElementById('coverageTarget').value);

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
      App.setStatus(App.t('statusLoadingConfig'), 'info');
      var res = await fetch('/api/config');
      if (!res.ok) throw new Error(App.t('statusConfigErr'));
      var configData = await res.json();
      App.setStatus(App.t('statusLoadingMaps'), 'info');
      await App.loadMaps(configData.key);
      App.initMap();
    }

    var orig = App.geoLocations.origin
      ? new google.maps.LatLng(App.geoLocations.origin.lat, App.geoLocations.origin.lng)
      : origText;
    var dest = App.geoLocations.dest
      ? new google.maps.LatLng(App.geoLocations.dest.lat, App.geoLocations.dest.lng)
      : destText;

    App.clearAll();
    App.setStatus(App.t('statusGettingRoute'), 'info');

    var directRoute = await App.getRoute(orig, dest);
    if (!directRoute) return;

    var bbox = App.getPathBbox(directRoute.path, 0.012);
    var city = App.detectCity(directRoute.path);
    var cityName = App.currentLang === 'he' ? city.nameHe : city.name;
    App.setStatus(App.t('statusFetchingShelters')(cityName), 'info');
    var shelters = await App.fetchShelters(bbox, directRoute.path);
    var dataSrcEl = document.getElementById('dataSrc');
    if (dataSrcEl && App.detectedCity) {
      dataSrcEl.innerHTML = 'Data: ' + App.detectedCity.nameHe + ' \u2014 GIS';
    }
    App.setStatus(App.t('statusFoundShelters')(shelters.length, coverageTarget), 'info');

    var buildResult = await App.buildShelterRoute(
      orig, dest, directRoute, shelters, radius, coverageTarget
    );
    var finalRoute = buildResult.waypointRoute || directRoute;

    var analysis = App.analyseRouteCoverage(finalRoute.path, shelters, radius);

    App.drawRoute(analysis.coveredPolyline, analysis.gapPolylines);
    App.drawShelterCircles(shelters, radius / App.WALK_FACTOR);
    App.drawShelterMarkers(shelters, buildResult.usedShelters);
    App.drawEndpoints(finalRoute);
    App.fitAll(finalRoute, shelters);

    App.setupDraggableRoute(finalRoute, shelters, radius);

    App.renderScore(analysis.coveredPct, analysis.gaps, finalRoute, shelters.length, coverageTarget);
    App.setStatus(App.t('statusCalcWalk'), 'info');
    var nearby = await App.renderShelterList(shelters, finalRoute.path, radius);
    App.renderGaps(analysis.gaps);
    App.fetchAndDisplayRatings((nearby || []).map(function(s) { return s.id; }));

    document.getElementById('legend').classList.add('show');
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('dragHint').classList.add('show');

    var pctLabel = analysis.coveredPct >= coverageTarget
      ? (analysis.coveredPct >= 99 ? App.t('statusFullCoverage') : App.t('statusMeetsTarget')(analysis.coveredPct, coverageTarget))
      : App.t('statusPartialCoverage')(analysis.coveredPct);
    App.setStatus(pctLabel, analysis.coveredPct >= coverageTarget ? 'ok' : analysis.coveredPct >= 70 ? 'info' : 'err');

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

  // Coverage target slider sync
  var ct = document.getElementById('coverageTarget');
  var ctv = document.getElementById('coverageTargetVal');
  if (ct && ctv) {
    ct.addEventListener('input', function() {
      ctv.textContent = ct.value + '%';
      var mct = document.getElementById('mobileCoverageTarget');
      var mctv = document.getElementById('mobileCoverageTargetVal');
      if (mct) mct.value = ct.value;
      if (mctv) mctv.textContent = ct.value + '%';
    });
  }
  var mct = document.getElementById('mobileCoverageTarget');
  var mctv = document.getElementById('mobileCoverageTargetVal');
  if (mct && mctv) {
    mct.addEventListener('input', function() {
      mctv.textContent = mct.value + '%';
      if (ct) ct.value = mct.value;
      if (ctv) ctv.textContent = mct.value + '%';
    });
  }

  // Shelter radius toggle sync
  function toggleShelterCircles(visible) {
    App.shelterCircles.forEach(function(c) { c.setMap(visible ? App.map : null); });
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
});

document.addEventListener('keydown', function(e) { if (e.key === 'Enter') App.run(); });

document.addEventListener('DOMContentLoaded', function() {
  if (App.isMobile()) {
    App.initBottomSheet();
    var legend = document.getElementById('legend');
    if (legend) legend.style.bottom = (App.SHEET_PEEK + 10) + 'px';
  }
});

window.addEventListener('resize', function() {
  if (App.isMobile() && App.sheetState !== 'hidden') {
    App.setSheetPosition(App.sheetState);
  }
});

// Init language from saved preference
App.setLang(localStorage.getItem('miklat-lang') || 'en');

// Load map eagerly so user sees Israel immediately
(async function preloadMap() {
  try {
    var res = await fetch('/api/config');
    if (!res.ok) return;
    var data = await res.json();
    await App.loadMaps(data.key);
    App.initMap();
  } catch (e) {
    // Map will load on first route request instead
  }
})();
