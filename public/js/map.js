window.App = window.App || {};

App.initMap = function() {
  App.map = L.map('map', {
    center: [31.75, 34.85],
    zoom: 8,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(App.map);

  App.mapsReady = true;

  App.map.on('click', function() {
    App.closeAllIW();
    if (App._routeInfoWindow) {
      App.map.closePopup(App._routeInfoWindow);
      App._routeInfoWindow = null;
    }
  });

  App.map.on('contextmenu', function(e) {
    if (App.handleMapRightClick) App.handleMapRightClick(e);
  });

  ['origin','dest','mobileOrigin','mobileDest'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) App.setupAutocomplete(el);
  });
};

App.setupAutocomplete = function(inputEl) {
  var container = inputEl.parentElement;
  container.style.position = 'relative';

  var dropdown = document.createElement('div');
  dropdown.className = 'nominatim-dropdown';
  container.appendChild(dropdown);

  var debounceTimer = null;

  inputEl.addEventListener('input', function() {
    clearTimeout(debounceTimer);
    inputEl._selectedPlace = null;
    var q = inputEl.value.trim();
    if (q.length < 3) { dropdown.style.display = 'none'; return; }
    debounceTimer = setTimeout(function() {
      var url = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=il&limit=5&q=' + encodeURIComponent(q);
      fetch(url).then(function(r) { return r.json(); }).then(function(results) {
        dropdown.innerHTML = '';
        if (!results.length) { dropdown.style.display = 'none'; return; }
        results.forEach(function(r) {
          var item = document.createElement('div');
          item.className = 'nominatim-item';
          item.textContent = r.display_name;
          item.addEventListener('click', function() {
            inputEl.value = r.display_name;
            inputEl._selectedPlace = {
              lat: parseFloat(r.lat),
              lng: parseFloat(r.lon),
            };
            dropdown.style.display = 'none';
            // Sync paired input
            var pairMap = { origin: 'mobileOrigin', dest: 'mobileDest', mobileOrigin: 'origin', mobileDest: 'dest' };
            var pairedEl = document.getElementById(pairMap[inputEl.id]);
            if (pairedEl) {
              pairedEl.value = r.display_name;
              pairedEl._selectedPlace = inputEl._selectedPlace;
            }
          });
          dropdown.appendChild(item);
        });
        dropdown.style.display = 'block';
      }).catch(function() {
        dropdown.style.display = 'none';
      });
    }, 400);
  });

  inputEl.addEventListener('focus', function() {
    if (dropdown.children.length > 0 && inputEl.value.trim().length >= 3) {
      dropdown.style.display = 'block';
    }
  });

  document.addEventListener('click', function(e) {
    if (!container.contains(e.target)) dropdown.style.display = 'none';
  });

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') dropdown.style.display = 'none';
  });
};

App._routeInfoWindow = null;

App._addRouteTooltip = function(polyline, content) {
  var isMobile = App.isMobile();
  var popup = L.popup({ closeButton: false, autoPan: false, className: 'route-tooltip-popup' });

  polyline.on(isMobile ? 'click' : 'mouseover', function(e) {
    if (App._routeInfoWindow) App.map.closePopup(App._routeInfoWindow);
    popup.setLatLng(e.latlng)
      .setContent('<div style="font-family:\'DM Mono\',monospace;font-size:11px;padding:2px 4px;white-space:nowrap">' + content + '</div>')
      .openOn(App.map);
    App._routeInfoWindow = popup;
  });

  if (!isMobile) {
    polyline.on('mouseout', function() {
      if (App._routeInfoWindow) {
        App.map.closePopup(App._routeInfoWindow);
        App._routeInfoWindow = null;
      }
    });
  }
};

App.drawRoute = function(coveredSegs, gapSegs, gaps) {
  coveredSegs.forEach(function(pts) {
    var pl = L.polyline(pts, {
      color: '#0f0f0f',
      weight: 5,
      opacity: 0.9,
    }).addTo(App.map);
    pl._isRoutePolyline = true;
    App.mapObjects.push(pl);
  });
  gapSegs.forEach(function(pts, i) {
    var pl = L.polyline(pts, {
      color: '#D93B22',
      weight: 5,
      opacity: 0.95,
      dashArray: '8, 12',
    }).addTo(App.map);
    pl._isRoutePolyline = true;
    var gap = gaps && gaps[i];
    if (gap) {
      var walkMin = Math.ceil(gap.distMeters / 1.4 / 60);
      App._addRouteTooltip(pl, App.t('gapTooltip')(gap.distMeters, walkMin));
    }
    App.mapObjects.push(pl);
  });
};

App.drawShelterCircles = function(shelters, radius) {
  App.shelterCircles.forEach(function(c) { if (App.map.hasLayer(c)) App.map.removeLayer(c); });
  App.shelterCircles = [];
  var visible = document.getElementById('showRadius').checked;
  shelters.forEach(function(s) {
    var c = L.circle(s.location, {
      radius: radius,
      fillColor: '#18C96A', fillOpacity: 0.10,
      color: '#18C96A', opacity: 0.45,
      weight: 1.5,
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
      fillColor: item.color, fillOpacity: 1,
      color: '#0f0f0f', weight: 2.5,
    }).addTo(App.map);
    App.mapObjects.push(m);
  });
};

App.fitAll = function(route, shelters) {
  var bounds = L.latLngBounds(route.path);
  shelters.forEach(function(s) { bounds.extend(s.location); });
  var bottomPad = App.isMobile() ? App.SHEET_PEEK + 20 : 50;
  var topPad = App.isMobile() ? 130 : 50;
  App.map.fitBounds(bounds, { paddingTopLeft: [50, topPad], paddingBottomRight: [50, bottomPad] });
};

App.closeAllIW = function() {
  App.map.closePopup();
};

App.clearAll = function() {
  App.mapObjects.forEach(function(o) {
    if (App.map.hasLayer(o)) App.map.removeLayer(o);
  });
  App.mapObjects = [];
  App.shelterCircles.forEach(function(c) { if (App.map.hasLayer(c)) App.map.removeLayer(c); });
  App.shelterCircles = [];
  App.shelterRatings = {};
  if (App.communityMarkers) {
    App.communityMarkers.forEach(function(o) { if (App.map.hasLayer(o)) App.map.removeLayer(o); });
    App.communityMarkers = [];
  }
  if (App._routeWaypoints) {
    App._routeWaypoints.forEach(function(wp) { if (App.map.hasLayer(wp)) App.map.removeLayer(wp); });
    App._routeWaypoints = [];
  }
  if (App._interactivePolyline) {
    if (App.map.hasLayer(App._interactivePolyline)) App.map.removeLayer(App._interactivePolyline);
    App._interactivePolyline = null;
  }
  if (App._routeInfoWindow) {
    App.map.closePopup(App._routeInfoWindow);
    App._routeInfoWindow = null;
  }

  document.getElementById('scoreWrap').classList.remove('show');
  document.getElementById('shareRow').style.display = 'none';
  App.lastRouteShare = null;
  document.getElementById('shelterSection').style.display = 'none';
  document.getElementById('shelterList').innerHTML = '';
  document.getElementById('legend').classList.remove('show');
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dragHint').classList.remove('show');

  var bsContent = document.getElementById('bottomSheetContent');
  if (bsContent) bsContent.innerHTML = '';
};
