window.App = window.App || {};

App.loadMaps = function() {
  App.mapsReady = true;
  return Promise.resolve();
};

App.initMap = function() {
  if (App.mapsReady) return;

  App.map = L.map('map', {
    center: [31.75, 34.85],
    zoom: 8,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(App.map);

  App.map.on('click', function() {
    App.map.closePopup();
  });

  App.map.on('contextmenu', function(e) {
    if (App.handleMapRightClick) App.handleMapRightClick(e);
  });

  ['origin', 'dest', 'mobileOrigin', 'mobileDest'].forEach(function(id) {
    App._initPhotonAutocomplete(id);
  });

  App.mapsReady = true;
};

// -- Photon (Komoot) autocomplete --

App._photonTimer = null;

App._photonSearch = function(query, callback) {
  if (App._photonTimer) clearTimeout(App._photonTimer);
  App._photonTimer = setTimeout(function() {
    fetch('https://photon.komoot.io/api/?' + new URLSearchParams({
      q: query + ', Israel',
      lat: '31.5',
      lon: '34.75',
      limit: '5',
    }))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      callback((data.features || []).map(function(f) {
        var p = f.properties;
        var parts = [p.name, p.street, p.housenumber, p.city, p.state].filter(Boolean);
        var name = parts.filter(function(v, i) { return i === 0 || v !== parts[i - 1]; }).join(', ');
        return { name: name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
      }));
    })
    .catch(function() { callback([]); });
  }, 300);
};

App._initPhotonAutocomplete = function(inputId) {
  var input = document.getElementById(inputId);
  if (!input) return;

  var dropdown = document.createElement('div');
  dropdown.className = 'photon-dropdown';
  var wrap = input.closest('.field') || input.closest('.input-wrap') || input.parentElement;
  wrap.style.position = 'relative';
  wrap.appendChild(dropdown);

  input.addEventListener('input', function() {
    var q = input.value.trim();
    if (q.length < 3) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
    App._photonSearch(q, function(results) {
      if (!results.length) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
      dropdown.innerHTML = '';
      dropdown.style.display = 'block';
      results.forEach(function(r) {
        var item = document.createElement('div');
        item.className = 'photon-item';
        item.textContent = r.name;
        item.addEventListener('mousedown', function(e) {
          e.preventDefault();
          input.value = r.name;
          dropdown.innerHTML = '';
          dropdown.style.display = 'none';
          var canonicalId = { mobileOrigin: 'origin', mobileDest: 'dest' }[inputId] || inputId;
          App.geoLocations[canonicalId] = { lat: r.lat, lng: r.lng };
          var pairs = { origin: 'mobileOrigin', dest: 'mobileDest', mobileOrigin: 'origin', mobileDest: 'dest' };
          var paired = document.getElementById(pairs[inputId]);
          if (paired) paired.value = r.name;
        });
        dropdown.appendChild(item);
      });
    });
  });

  input.addEventListener('blur', function() {
    setTimeout(function() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }, 200);
  });
};

// -- Route tooltip --

App._addRouteTooltip = function(polyline, content) {
  var htmlContent = '<div style="font-family:\'DM Mono\',monospace;font-size:11px;padding:2px 4px;white-space:nowrap">' + content + '</div>';
  if (App.isMobile()) {
    polyline.bindPopup(htmlContent, { closeButton: false, autoPan: false });
  } else {
    polyline.bindTooltip(htmlContent, { sticky: true, direction: 'top' });
  }
};

// -- Drawing --

App.drawRoute = function(coveredSegs, gapSegs, gaps) {
  coveredSegs.forEach(function(pts) {
    var pl = L.polyline(pts, {
      color: '#0f0f0f',
      weight: 5,
      opacity: 0.9,
    }).addTo(App.map);
    App.mapObjects.push(pl);
  });
  gapSegs.forEach(function(pts, i) {
    var pl = L.polyline(pts, {
      color: '#D93B22',
      weight: 5,
      opacity: 0.95,
      dashArray: '8,12',
    }).addTo(App.map);
    var gap = gaps && gaps[i];
    if (gap) {
      var walkMin = Math.ceil(gap.distMeters / 1.4 / 60);
      App._addRouteTooltip(pl, App.t('gapTooltip')(gap.distMeters, walkMin));
    }
    App.mapObjects.push(pl);
  });
};

App.drawShelterCircles = function(shelters, radius) {
  App.shelterCircles.forEach(function(c) { c.remove(); });
  App.shelterCircles = [];
  var visible = document.getElementById('showRadius').checked;
  shelters.forEach(function(s) {
    var c = L.circle(s.location, {
      radius: radius,
      color: '#18C96A',
      weight: 1.5,
      opacity: 0.45,
      fillColor: '#18C96A',
      fillOpacity: 0.10,
    });
    if (visible) c.addTo(App.map);
    App.shelterCircles.push(c);
  });
};

App.drawShelterMarkers = function(shelters, usedShelters) {
  var usedIds = new Set(usedShelters.map(function(s) { return s.id; }));
  shelters.forEach(function(s, i) {
    var isWaypoint = usedIds.has(s.id);
    var isCommunity = s.community === true;
    var markerColor = isCommunity ? '#E88A1A' : '#1A4DE8';
    var esc = App.escapeHtml;
    var displayName = esc(s.type || s.name || '');
    var displayAddr = esc(s.addr || '');
    var displayNotes = s.notes ? esc(s.notes) : '';

    var marker = L.circleMarker(s.location, {
      radius: isWaypoint ? 10 : 7,
      fillColor: markerColor,
      fillOpacity: 1,
      color: isWaypoint ? '#0f0f0f' : '#fff',
      weight: isWaypoint ? 2.5 : 1.5,
    }).addTo(App.map);

    var accessBadge = s.accessible === '\u05db\u05df'
      ? '<span style="color:#2e7d32;font-size:10px">\u267f \u05e0\u05d2\u05d9\u05e9</span>' : '';
    var statusBadge = s.status
      ? '<span style="color:' + (s.status === '\u05db\u05e9\u05d9\u05e8 \u05dc\u05e9\u05d9\u05de\u05d5\u05e9' ? '#2e7d32' : '#D93B22') + ';font-size:10px">' + esc(s.status) + '</span>' : '';
    var areaStr = s.area ? '<br><span style="color:#888;font-size:10px">' + esc(String(s.area)) + ' \u05de\u05f4\u05e8</span>' : '';
    var filtStr = s.filtration && s.filtration !== '\u05dc\u05dc\u05d0 \u05de\u05e2\u05e8\u05db\u05ea \u05e1\u05d9\u05e0\u05d5\u05df'
      ? '<br><span style="color:#1565c0;font-size:10px">\ud83d\udee1 ' + esc(s.filtration) + '</span>' : '';
    var notesStr = displayNotes
      ? '<div style="margin-top:4px;padding-top:4px;border-top:1px solid #eee;font-size:10px;color:#666;direction:rtl;text-align:right;max-width:240px">' + displayNotes + '</div>' : '';

    var communityBadgeHtml = isCommunity
      ? '<div style="margin-bottom:4px"><span style="background:#E88A1A;color:#fff;font-size:8px;padding:2px 6px;border-radius:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">' + App.t('communityBadge') + '</span></div>' : '';

    var popupContent = '<div style="font-family:\'DM Mono\',monospace;font-size:12px;padding:2px 4px;max-width:280px">' +
      communityBadgeHtml +
      '<b style="font-family:\'Syne\',sans-serif;font-size:13px">' + displayName + '</b>' +
      (displayAddr ? '<br><span style="color:#888">' + displayAddr + '</span>' : '') +
      '<br><span style="color:#1A4DE8;font-size:11px">' + (isWaypoint ? App.t('routeWaypoint') : '\u05de\u05e7\u05dc\u05d8 #' + (s.ms_miklat || '')) + '</span>' +
      areaStr + filtStr +
      '<br>' + statusBadge + ' ' + accessBadge +
      notesStr +
      '<div class="iw-rating-line" data-shelter="' + s.id + '" style="margin-top:6px;font-size:11px"></div>' +
      '<div class="iw-reviews" data-shelter="' + s.id + '"></div>' +
      '<div class="review-form" style="margin-top:8px;padding-top:6px;border-top:1px solid #eee">' +
        '<div style="font-size:10px;color:#888;margin-bottom:2px">' + App.t('rateThisShelter') + '</div>' +
        '<div class="star-input" data-shelter="' + s.id + '" style="direction:ltr">' +
          '<span data-v="1">\u2606</span><span data-v="2">\u2606</span><span data-v="3">\u2606</span><span data-v="4">\u2606</span><span data-v="5">\u2606</span>' +
        '</div>' +
        '<textarea placeholder="' + App.t('phReview') + '" maxlength="500"></textarea>' +
        '<button onclick="submitReview(\'' + s.id + '\', this)">' + App.t('submitBtn') + '</button>' +
      '</div>' +
      '<div style="margin-top:4px;color:#aaa;font-size:9px">' + (App.detectedCity ? App.detectedCity.nameHe : '') + '</div>' +
    '</div>';

    marker.bindPopup(popupContent, { maxWidth: 300 });

    marker.on('click', function() {
      App.highlightCard(i);
    });

    marker.on('popupopen', function() {
      var r = App.shelterRatings[s.id];
      var rLine = document.querySelector('.iw-rating-line[data-shelter="' + s.id + '"]');
      if (rLine && r) {
        rLine.innerHTML = '<span style="color:var(--amber)">' + App.renderStars(r.avg) + '</span> ' + r.avg + ' <span style="color:#888">(' + r.count + ')</span>';
      }
      var rDiv = document.querySelector('.iw-reviews[data-shelter="' + s.id + '"]');
      if (rDiv && r && r.reviews.length) {
        rDiv.innerHTML = r.reviews.slice(0, 3).map(function(rv) {
          return '<div class="iw-review"><span class="iw-r-stars">' + App.renderStars(rv.rating) + '</span> ' + (rv.text ? App.escapeHtml(rv.text) : '') + '</div>';
        }).join('');
      }
      var starInput = document.querySelector('.star-input[data-shelter="' + s.id + '"]');
      if (starInput) {
        starInput.querySelectorAll('span').forEach(function(sp) {
          sp.addEventListener('click', function() {
            var v = parseInt(sp.dataset.v);
            starInput.querySelectorAll('span').forEach(function(x, xi) {
              x.textContent = xi < v ? '\u2605' : '\u2606';
              x.classList.toggle('active', xi < v);
            });
          });
        });
      }
    });

    App.mapObjects.push(marker);
    s._marker = marker;
    s._idx = i;
  });
};

App.drawEndpoints = function(route) {
  [
    { pos: route.startLocation, color: '#18C96A', title: 'Start' },
    { pos: route.endLocation,   color: '#D93B22', title: 'End'   },
  ].forEach(function(item) {
    var m = L.circleMarker(item.pos, {
      radius: 11,
      fillColor: item.color,
      fillOpacity: 1,
      color: '#0f0f0f',
      weight: 2.5,
    }).addTo(App.map);
    App.mapObjects.push(m);
  });
};

App.fitAll = function(route, shelters) {
  var bounds = L.latLngBounds([]);
  route.path.forEach(function(p) { bounds.extend(p); });
  shelters.forEach(function(s) { bounds.extend(s.location); });
  var bottomPad = App.isMobile() ? App.SHEET_PEEK + 20 : 50;
  var topPad = App.isMobile() ? 130 : 50;
  App.map.fitBounds(bounds, { paddingTopLeft: [50, topPad], paddingBottomRight: [50, bottomPad] });
};

App.closeAllIW = function() {
  if (App.map) App.map.closePopup();
};

App.clearAll = function() {
  if (App._dragCleanup) App._dragCleanup();
  App.mapObjects.forEach(function(o) {
    if (o.remove) o.remove();
  });
  App.mapObjects = [];
  App.shelterCircles.forEach(function(c) { c.remove(); });
  App.shelterCircles = [];
  App.shelterRatings = {};
  if (App.communityMarkers) {
    App.communityMarkers.forEach(function(o) { if (o.remove) o.remove(); });
    App.communityMarkers = [];
  }

  document.getElementById('scoreWrap').classList.remove('show');
  document.getElementById('shareRow').style.display = 'none';
  App.lastRouteShare = null;
  document.getElementById('shelterSection').style.display = 'none';
  document.getElementById('shelterList').innerHTML = '';
  document.getElementById('legend').classList.remove('show');
  document.getElementById('emptyState').style.display = 'none';

  var bsContent = document.getElementById('bottomSheetContent');
  if (bsContent) bsContent.innerHTML = '';
};
