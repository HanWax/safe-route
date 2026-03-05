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
App._communityAutocomplete = null;

// Ensure map is loaded before community actions
App._ensureMap = async function() {
  if (App.mapsReady) return true;
  try {
    var res = await fetch('/api/config');
    if (!res.ok) return false;
    var data = await res.json();
    await App.loadMaps(data.key);
    App.initMap();
    return true;
  } catch (e) {
    App.setStatus(App.t('statusConfigErr'), 'err');
    return false;
  }
};

// Button click: show form immediately with address autocomplete (no map pin)
App.startAddMiklat = async function() {
  if (!(await App._ensureMap())) return;

  App.communityPlacementLatLng = null;
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.setMap(null);
    App.communityPlacementMarker = null;
  }

  App._showCommunityForm(true);
};

// Right-click on map: place pin, reverse geocode, show form with address pre-filled
// Called from map.js rightclick listener
App.handleMapRightClick = function(e) {
  App.communityPlacementLatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() };
  App._placeOrMoveMarker(e.latLng);
  App._showCommunityForm(false);
  App._reverseGeocode(e.latLng);
};

App._placeOrMoveMarker = function(latLng) {
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.setPosition(latLng);
    App.communityPlacementMarker.setMap(App.map);
  } else {
    App.communityPlacementMarker = new google.maps.Marker({
      position: latLng,
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
      App._reverseGeocode(pos);
    });
  }
};

App._showCommunityForm = function(isButtonMode) {
  document.getElementById('communityFormOverlay').classList.add('show');
  document.getElementById('communityNameInput').value = '';
  document.getElementById('communityDescInput').value = '';
  document.getElementById('communityAddrStatus').textContent = '';
  document.getElementById('communityAddrStatus').className = 'community-form-addr-status';

  var addrInput = document.getElementById('communityAddressInput');
  if (isButtonMode) {
    addrInput.value = '';
    addrInput.focus();
  }

  // Attach Places Autocomplete to address field (once)
  if (!App._communityAutocomplete && window.google && google.maps.places) {
    App._communityAutocomplete = new google.maps.places.Autocomplete(
      addrInput,
      { componentRestrictions: { country: 'il' } }
    );
    App._communityAutocomplete.addListener('place_changed', function() {
      var place = App._communityAutocomplete.getPlace();
      if (place && place.geometry && place.geometry.location) {
        var loc = place.geometry.location;
        App.communityPlacementLatLng = { lat: loc.lat(), lng: loc.lng() };
        App._placeOrMoveMarker(loc);
        App.map.panTo(loc);
        App.map.setZoom(17);
        document.getElementById('communityAddrStatus').textContent = '';
      }
    });
  }
};

App._reverseGeocode = function(latLng) {
  var addrInput = document.getElementById('communityAddressInput');
  var statusEl = document.getElementById('communityAddrStatus');
  statusEl.textContent = App.t('communityReverseGeocoding');
  statusEl.className = 'community-form-addr-status';

  var geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: latLng }, function(results, status) {
    if (status === 'OK' && results[0]) {
      addrInput.value = results[0].formatted_address;
      statusEl.textContent = '';
    } else {
      statusEl.textContent = '';
    }
    addrInput.focus();
  });
};

App.cancelAddMiklat = function() {
  App.communityPlacementMode = false;
  document.getElementById('communityFormOverlay').classList.remove('show');
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.setMap(null);
    App.communityPlacementMarker = null;
  }
  App.communityPlacementLatLng = null;
  if (App.map) App.map.setOptions({ draggableCursor: null });
};

App.saveCommunityMiklat = async function() {
  var addrInput = document.getElementById('communityAddressInput');
  var address = addrInput.value.trim();
  var name = document.getElementById('communityNameInput').value.trim();
  var desc = document.getElementById('communityDescInput').value.trim();
  var statusEl = document.getElementById('communityAddrStatus');

  if (!address) {
    statusEl.textContent = App.t('communityAddressRequired');
    statusEl.className = 'community-form-addr-status err';
    addrInput.focus();
    return;
  }
  if (!name) {
    document.getElementById('communityNameInput').focus();
    return;
  }

  var btn = document.getElementById('communitySaveBtn');
  btn.disabled = true;
  btn.textContent = App.t('communitySaving');

  // If we don't have coords yet (user typed address via button mode), geocode first
  if (!App.communityPlacementLatLng) {
    try {
      var coords = await App._geocodeAddress(address);
      if (!coords) {
        statusEl.textContent = App.t('communityGeocodeFailed');
        statusEl.className = 'community-form-addr-status err';
        btn.disabled = false;
        btn.textContent = App.t('communitySave');
        return;
      }
      App.communityPlacementLatLng = coords;
      App._placeOrMoveMarker(new google.maps.LatLng(coords.lat, coords.lng));
      App.map.panTo(new google.maps.LatLng(coords.lat, coords.lng));
    } catch (e) {
      statusEl.textContent = App.t('communityGeocodeFailed');
      statusEl.className = 'community-form-addr-status err';
      btn.disabled = false;
      btn.textContent = App.t('communitySave');
      return;
    }
  }

  var coords = App.communityPlacementLatLng;

  try {
    var res = await fetch('/api/community-shelter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat: coords.lat, lng: coords.lng, name: name, description: desc }),
    });
    if (!res.ok) throw new Error('Failed');

    var saved = await res.json();

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

App._geocodeAddress = function(address) {
  return new Promise(function(resolve) {
    var geocoder = new google.maps.Geocoder();
    geocoder.geocode(
      { address: address, componentRestrictions: { country: 'IL' } },
      function(results, status) {
        if (status === 'OK' && results[0] && results[0].geometry) {
          var loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        } else {
          resolve(null);
        }
      }
    );
  });
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
