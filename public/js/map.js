window.App = window.App || {};

App.loadMaps = function(key) {
  var old = document.getElementById('_gms');
  if (old) { old.remove(); delete window.google; App.mapsReady = false; }
  return new Promise(function(res, rej) {
    window.__mapsLoaded = function() { App.mapsReady = true; res(); };
    var s = document.createElement('script');
    s.id = '_gms';
    var mapsLang = App.currentLang === 'he' ? 'iw' : 'en';
    s.src = 'https://maps.googleapis.com/maps/api/js?key=' + key + '&libraries=places,geometry&callback=__mapsLoaded&language=' + mapsLang + '&loading=async';
    s.onerror = function() { rej(new Error('Failed to load Google Maps \u2014 check your API key and that Maps JS API + Directions API are enabled.')); };
    document.head.appendChild(s);
  });
};

App.initMap = function() {
  App.map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 31.75, lng: 34.85 },
    zoom: 8,
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    styles: [
      { featureType:'all', elementType:'geometry', stylers:[{color:'#f2ede4'}] },
      { featureType:'water', elementType:'geometry', stylers:[{color:'#c3dff0'}] },
      { featureType:'road', elementType:'geometry', stylers:[{color:'#ffffff'}] },
      { featureType:'road.arterial', elementType:'geometry', stylers:[{color:'#e8e0d0'}] },
      { featureType:'road.highway', elementType:'geometry', stylers:[{color:'#d6ccbc'}] },
      { featureType:'poi', elementType:'labels', stylers:[{visibility:'off'}] },
      { featureType:'landscape.man_made', elementType:'geometry', stylers:[{color:'#ece6dc'}] },
    ],
  });
  App.dirSvc = new google.maps.DirectionsService();
  App.dirRenderer = new google.maps.DirectionsRenderer({
    suppressMarkers: true,
    preserveViewport: true,
    polylineOptions: { strokeOpacity: 0 },
  });
  App.dirRenderer.setMap(App.map);

  App.map.addListener('click', function() { App.closeAllIW(); });

  // Right-click to add community miklat (always available once map loads)
  App.map.addListener('rightclick', function(e) {
    if (App.handleMapRightClick) App.handleMapRightClick(e);
  });

  ['origin','dest','mobileOrigin','mobileDest'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) {
      new google.maps.places.Autocomplete(
        el,
        { componentRestrictions: { country: 'il' } }
      );
    }
  });
  google.maps.event.trigger(App.map, 'resize');
};

App.drawRoute = function(coveredSegs, gapSegs) {
  coveredSegs.forEach(function(pts) {
    var pl = new google.maps.Polyline({
      path: pts, map: App.map,
      strokeColor: '#0f0f0f',
      strokeWeight: 5,
      strokeOpacity: 0.9,
      zIndex: 4,
    });
    App.mapObjects.push(pl);
  });
  gapSegs.forEach(function(pts) {
    var pl = new google.maps.Polyline({
      path: pts, map: App.map,
      strokeColor: '#D93B22',
      strokeWeight: 5,
      strokeOpacity: 0.95,
      zIndex: 5,
      icons: [{
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
        offset: '0', repeat: '12px',
      }],
    });
    App.mapObjects.push(pl);
  });
};

App.drawShelterCircles = function(shelters, radius) {
  App.shelterCircles.forEach(function(c) { c.setMap(null); });
  App.shelterCircles = [];
  var visible = document.getElementById('showRadius').checked;
  shelters.forEach(function(s) {
    var c = new google.maps.Circle({
      center: s.location, radius: radius,
      map: visible ? App.map : null,
      fillColor: '#18C96A', fillOpacity: 0.10,
      strokeColor: '#18C96A', strokeOpacity: 0.45,
      strokeWeight: 1.5, zIndex: 1,
    });
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
    var marker = new google.maps.Marker({
      position: s.location, map: App.map,
      title: s.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: isWaypoint ? 10 : 7,
        fillColor: markerColor,
        fillOpacity: 1,
        strokeColor: isWaypoint ? '#0f0f0f' : '#fff',
        strokeWeight: isWaypoint ? 2.5 : 1.5,
      },
      zIndex: isWaypoint ? 12 : 8,
    });

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

    var iw = new google.maps.InfoWindow({
      content: '<div style="font-family:\'DM Mono\',monospace;font-size:12px;padding:2px 4px;max-width:280px">' +
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
      '</div>'
    });
    marker.addListener('click', function() {
      App.closeAllIW();
      iw.open(App.map, marker);
      App.highlightCard(i);
    });
    google.maps.event.addListener(iw, 'domready', function() {
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
    App.mapObjects.push(iw);
    s._marker = marker;
    s._iw = iw;
    s._idx = i;
  });
};

App.drawEndpoints = function(route) {
  [
    { pos: route.startLocation, color: '#18C96A', title: 'Start' },
    { pos: route.endLocation,   color: '#D93B22', title: 'End'   },
  ].forEach(function(item) {
    var m = new google.maps.Marker({
      position: item.pos, map: App.map, title: item.title,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 11,
        fillColor: item.color, fillOpacity: 1,
        strokeColor: '#0f0f0f', strokeWeight: 2.5,
      },
      zIndex: 20,
    });
    App.mapObjects.push(m);
  });
};

App.fitAll = function(route, shelters) {
  var bounds = new google.maps.LatLngBounds();
  route.path.forEach(function(p) { bounds.extend(p); });
  shelters.forEach(function(s) { bounds.extend(s.location); });
  var bottomPad = App.isMobile() ? App.SHEET_PEEK + 20 : 50;
  var topPad = App.isMobile() ? 130 : 50;
  App.map.fitBounds(bounds, { top: topPad, right: 50, bottom: bottomPad, left: 50 });
};

App.closeAllIW = function() {
  App.mapObjects.forEach(function(o) { if (o instanceof google.maps.InfoWindow) o.close(); });
};

App.clearAll = function() {
  App.mapObjects.forEach(function(o) {
    if (o.setMap) o.setMap(null);
    else if (o.close) o.close();
  });
  App.mapObjects = [];
  App.shelterCircles.forEach(function(c) { c.setMap(null); });
  App.shelterCircles = [];
  App.shelterRatings = {};
  if (App.communityMarkers) {
    App.communityMarkers.forEach(function(o) { if (o.setMap) o.setMap(null); else if (o.close) o.close(); });
    App.communityMarkers = [];
  }
  if (App.dirRenderer) App.dirRenderer.setDirections({ routes: [] });
  if (App.draggableRenderer) {
    App.draggableRenderer.setMap(null);
    App.draggableRenderer = null;
  }

  document.getElementById('scoreWrap').classList.remove('show');
  document.getElementById('shelterSection').style.display = 'none';
  document.getElementById('gapSection').style.display = 'none';
  document.getElementById('shelterList').innerHTML = '';
  document.getElementById('gapList').innerHTML = '';
  document.getElementById('legend').classList.remove('show');
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dragHint').classList.remove('show');

  var bsContent = document.getElementById('bottomSheetContent');
  if (bsContent) bsContent.innerHTML = '';
};
