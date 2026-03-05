window.App = window.App || {};

App.escapeHtml = function(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
};

App.communityPlacementMode = false;
App.communityPlacementMarker = null;
App.communityPlacementLatLng = null;
App.communityMarkers = [];

App.startAddMiklat = async function() {
  // Ensure map is loaded
  if (!App.mapsReady) {
    try {
      var res = await fetch('/api/config');
      if (!res.ok) return;
      var data = await res.json();
      await App.loadMaps(data.key);
      App.initMap();
    } catch (e) {
      App.setStatus(App.t('statusConfigErr'), 'err');
      return;
    }
  }

  App.communityPlacementMode = true;
  document.getElementById('communityBar').classList.add('show');
  document.getElementById('communityFormOverlay').classList.remove('show');
  App.map.setOptions({ draggableCursor: 'crosshair' });

  if (!App._communityClickListener) {
    App._communityClickListener = App.map.addListener('click', function(e) {
      if (!App.communityPlacementMode) return;
      App.communityPlacementLatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };

      if (App.communityPlacementMarker) {
        App.communityPlacementMarker.setPosition(e.latLng);
      } else {
        App.communityPlacementMarker = new google.maps.Marker({
          position: e.latLng,
          map: App.map,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: '#E88A1A',
            fillOpacity: 1,
            strokeColor: '#0f0f0f',
            strokeWeight: 2,
          },
          zIndex: 30,
          draggable: true,
        });
        google.maps.event.addListener(App.communityPlacementMarker, 'dragend', function() {
          var pos = App.communityPlacementMarker.getPosition();
          App.communityPlacementLatLng = { lat: pos.lat(), lng: pos.lng() };
        });
      }

      // Show the form
      document.getElementById('communityBar').classList.remove('show');
      document.getElementById('communityFormOverlay').classList.add('show');
      document.getElementById('communityNameInput').value = '';
      document.getElementById('communityDescInput').value = '';
      document.getElementById('communityNameInput').focus();
    });
  }
};

App.cancelAddMiklat = function() {
  App.communityPlacementMode = false;
  document.getElementById('communityBar').classList.remove('show');
  document.getElementById('communityFormOverlay').classList.remove('show');
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.setMap(null);
    App.communityPlacementMarker = null;
  }
  App.communityPlacementLatLng = null;
  if (App.map) App.map.setOptions({ draggableCursor: null });
};

App.saveCommunityMiklat = async function() {
  var name = document.getElementById('communityNameInput').value.trim();
  var desc = document.getElementById('communityDescInput').value.trim();
  var coords = App.communityPlacementLatLng;

  if (!name) {
    document.getElementById('communityNameInput').focus();
    return;
  }
  if (!coords) return;

  var btn = document.getElementById('communitySaveBtn');
  btn.disabled = true;
  btn.textContent = App.t('communitySaving');

  try {
    var res = await fetch('/api/community-shelter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.lat, lng: coords.lng, name: name, description: desc }),
    });
    if (!res.ok) throw new Error('Failed');

    var saved = await res.json();

    // Add a permanent community marker at this location
    App.addCommunityMarkerToMap({
      id: 'comm-' + saved.id,
      lat: coords.lat,
      lng: coords.lng,
      name: name,
      description: desc,
      community: true,
    });

    btn.textContent = App.t('communitySaved');
    setTimeout(function() {
      App.cancelAddMiklat();
      btn.disabled = false;
      btn.textContent = App.t('communitySave');
    }, 1200);
  } catch (e) {
    btn.textContent = App.t('communityError');
    btn.disabled = false;
    setTimeout(function() { btn.textContent = App.t('communitySave'); }, 2000);
  }
};

App.addCommunityMarkerToMap = function(s) {
  if (!App.map) return;
  var safeName = App.escapeHtml(s.name);
  var safeDesc = s.description ? App.escapeHtml(s.description) : '';
  var pos = new google.maps.LatLng(s.lat, s.lng);
  var marker = new google.maps.Marker({
    position: pos,
    map: App.map,
    title: s.name,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 9,
      fillColor: '#E88A1A',
      fillOpacity: 1,
      strokeColor: '#0f0f0f',
      strokeWeight: 1.5,
    },
    zIndex: 9,
  });

  var iw = new google.maps.InfoWindow({
    content: '<div style="font-family:\'DM Mono\',monospace;font-size:12px;padding:2px 4px;max-width:260px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<span style="background:#E88A1A;color:#fff;font-size:8px;padding:2px 6px;border-radius:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">' + App.t('communityBadge') + '</span>' +
      '</div>' +
      '<b style="font-family:\'Syne\',sans-serif;font-size:13px">' + safeName + '</b>' +
      (safeDesc ? '<div style="color:#666;font-size:11px;margin-top:4px;line-height:1.4">' + safeDesc + '</div>' : '') +
      '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #eee;font-size:9px;color:#aaa">' + App.t('communityDisclaimer') + '</div>' +
    '</div>'
  });

  marker.addListener('click', function() {
    App.closeAllIW();
    iw.open(App.map, marker);
  });

  App.communityMarkers.push(marker);
  App.communityMarkers.push(iw);

  // Also add to mapObjects for cleanup and InfoWindow close on map click
  App.mapObjects.push(marker);
  App.mapObjects.push(iw);
};

App.fetchCommunityShelters = async function(bbox) {
  try {
    var params = new URLSearchParams({
      south: bbox.south, north: bbox.north,
      west: bbox.west, east: bbox.east,
    });
    var res = await fetch('/api/community-shelters?' + params);
    if (!res.ok) return [];
    var rows = await res.json();
    return rows.map(function(r) {
      return {
        id: 'comm-' + r.id,
        lat: r.lat,
        lng: r.lng,
        lon: r.lng,
        name: r.name,
        description: r.description,
        community: true,
        source: 'community',
        type: '',
        addr: '',
        addrEng: '',
        area: 0,
        filtration: '',
        notes: '',
        status: '',
        accessible: '',
        location: null, // will be set after google maps is loaded
      };
    });
  } catch (e) {
    console.warn('community shelters fetch failed', e);
    return [];
  }
};
