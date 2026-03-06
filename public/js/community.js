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
App._communityAutocomplete = false;

// Ensure map is loaded before community actions
App._ensureMap = function() {
  if (App.mapsReady) return Promise.resolve(true);
  App.initMap();
  return Promise.resolve(true);
};

// Button click: show form immediately with address autocomplete (no map pin)
App.startAddMiklat = async function() {
  if (!(await App._ensureMap())) return;

  App.communityPlacementLatLng = null;
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.remove();
    App.communityPlacementMarker = null;
  }

  App._showCommunityForm(true);
};

// Right-click on map: place pin, reverse geocode, show form with address pre-filled
App.handleMapRightClick = function(e) {
  App.communityPlacementLatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
  App._placeOrMoveMarker(e.latlng);
  App._showCommunityForm(false);
  App._reverseGeocode(e.latlng);
};

App._placeOrMoveMarker = function(latLng) {
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.setLatLng(latLng);
    if (!App.map.hasLayer(App.communityPlacementMarker)) {
      App.communityPlacementMarker.addTo(App.map);
    }
  } else {
    App.communityPlacementMarker = L.marker(latLng, {
      draggable: true,
      icon: L.divIcon({
        className: '',
        html: '<div style="width:24px;height:24px;border-radius:50%;background:#E88A1A;border:2px solid #0f0f0f;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      zIndexOffset: 1000,
    }).addTo(App.map);

    App.communityPlacementMarker.on('dragend', function() {
      var pos = App.communityPlacementMarker.getLatLng();
      App.communityPlacementLatLng = { lat: pos.lat, lng: pos.lng };
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

  // Attach Photon autocomplete to community address field (once)
  if (!App._communityAutocomplete) {
    App._communityAutocomplete = true;
    App._initCommunityPhoton(addrInput);
  }
};

App._initCommunityPhoton = function(addrInput) {
  var dropdown = document.createElement('div');
  dropdown.className = 'photon-dropdown';
  addrInput.parentElement.style.position = 'relative';
  addrInput.parentElement.appendChild(dropdown);

  addrInput.addEventListener('input', function() {
    var q = addrInput.value.trim();
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
          addrInput.value = r.name;
          dropdown.innerHTML = '';
          dropdown.style.display = 'none';
          App.communityPlacementLatLng = { lat: r.lat, lng: r.lng };
          var latlng = L.latLng(r.lat, r.lng);
          App._placeOrMoveMarker(latlng);
          App.map.panTo(latlng);
          App.map.setZoom(17);
          document.getElementById('communityAddrStatus').textContent = '';
        });
        dropdown.appendChild(item);
      });
    });
  });

  addrInput.addEventListener('blur', function() {
    setTimeout(function() { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }, 200);
  });
};

App._reverseGeocode = function(latLng) {
  var addrInput = document.getElementById('communityAddressInput');
  var statusEl = document.getElementById('communityAddrStatus');
  statusEl.textContent = App.t('communityReverseGeocoding');
  statusEl.className = 'community-form-addr-status';

  var lat = latLng.lat;
  var lng = latLng.lng;

  App.nominatimReverse(lat, lng).then(function(address) {
    if (address) {
      addrInput.value = address;
    }
    statusEl.textContent = '';
    addrInput.focus();
  }).catch(function() {
    statusEl.textContent = '';
    addrInput.focus();
  });
};

App.cancelAddMiklat = function() {
  App.communityPlacementMode = false;
  document.getElementById('communityFormOverlay').classList.remove('show');
  if (App.communityPlacementMarker) {
    App.communityPlacementMarker.remove();
    App.communityPlacementMarker = null;
  }
  App.communityPlacementLatLng = null;
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
      var latlng = L.latLng(coords.lat, coords.lng);
      App._placeOrMoveMarker(latlng);
      App.map.panTo(latlng);
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
  return App.nominatimGeocode(address);
};

App.addCommunityMarkerToMap = function(s) {
  if (!App.map) return;
  var safeName = App.escapeHtml(s.name);
  var safeDesc = s.description ? App.escapeHtml(s.description) : '';
  var pos = L.latLng(s.lat, s.lng);

  var marker = L.circleMarker(pos, {
    radius: 9,
    fillColor: '#E88A1A',
    fillOpacity: 1,
    color: '#0f0f0f',
    weight: 1.5,
  }).addTo(App.map);

  var popupContent = '<div style="font-family:\'DM Mono\',monospace;font-size:12px;padding:2px 4px;max-width:260px">' +
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="background:#E88A1A;color:#fff;font-size:8px;padding:2px 6px;border-radius:2px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">' + App.t('communityBadge') + '</span>' +
    '</div>' +
    '<b style="font-family:\'Syne\',sans-serif;font-size:13px">' + safeName + '</b>' +
    (safeDesc ? '<div style="color:#666;font-size:11px;margin-top:4px;line-height:1.4">' + safeDesc + '</div>' : '') +
    '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #eee;font-size:9px;color:#aaa">' + App.t('communityDisclaimer') + '</div>' +
  '</div>';

  marker.bindPopup(popupContent, { maxWidth: 280 });

  App.communityMarkers.push(marker);
  App.mapObjects.push(marker);
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
        location: null,
      };
    });
  } catch (e) {
    console.warn('community shelters fetch failed', e);
    return [];
  }
};
