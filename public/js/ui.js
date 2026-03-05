window.App = window.App || {};

App.setStatus = function(msg, type) {
  var el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (type || '');
  if (App.isMobile()) App.setMobileStatus(msg, type);
};

App._countUp = function(el, target, suffix, duration) {
  suffix = suffix || '';
  duration = duration || 600;
  var start = 0;
  var startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = Math.round(start + (target - start) * eased);
    el.textContent = current + suffix;
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
};

App.setBusy = function(b) {
  var btn = document.getElementById('goBtn');
  btn.classList.toggle('loading', b);
  btn.disabled = b;
  var mBtn = document.getElementById('mobileGoBtn');
  if (mBtn) { mBtn.classList.toggle('loading', b); mBtn.disabled = b; }
};

App.renderScore = function(pct, gaps, route, shelterCount, coverageTarget) {
  coverageTarget = coverageTarget || 80;
  var wrap = document.getElementById('scoreWrap');
  wrap.classList.add('show');

  var el = document.getElementById('scorePct');
  var meetsTarget = pct >= coverageTarget;
  el.className = 'score-pct ' + (meetsTarget ? (pct >= 99 ? 'full' : 'high') : pct >= 50 ? 'mid' : 'low');
  App._countUp(el, pct, '%', 700);

  var bar = document.getElementById('scoreBar');
  bar.style.width = '0%';
  bar.style.background = meetsTarget ? (pct >= 99 ? '#18C96A' : '#8BC34A') : pct >= 50 ? '#E8920F' : '#D93B22';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      bar.style.width = pct + '%';
    });
  });

  var scoreLabel = document.getElementById('scoreLabel');
  if (scoreLabel) {
    scoreLabel.textContent = meetsTarget
      ? 'Coverage (target: ' + coverageTarget + '% \u2713)'
      : 'Coverage (target: ' + coverageTarget + '%)';
  }

  var totalSec = route.totalDuration || 0;
  var h = Math.floor(totalSec / 3600);
  var m = Math.floor((totalSec % 3600) / 60);
  var timeStr = h > 0 ? h + 'h ' + m + 'm' : m + ' min';
  var distM = route.totalDistance || 0;
  var distStr = distM >= 1000 ? (distM/1000).toFixed(1) + ' km' : distM + ' m';

  document.getElementById('routeDist').textContent = distStr;
  document.getElementById('routeTime').textContent = timeStr;
  document.getElementById('metaShelters').textContent = shelterCount;

  var gapCount = gaps.length;
  var gapDistTotal = gaps.reduce(function(s, g) { return s + g.distMeters; }, 0);
  document.getElementById('metaGaps').textContent = gapCount;
  document.getElementById('metaGapDist').textContent =
    gapDistTotal > 0 ? (gapDistTotal >= 1000 ? (gapDistTotal/1000).toFixed(1) + 'km' : gapDistTotal + 'm') : '0m';
};

App.renderGaps = function(gaps) {
  var sec = document.getElementById('gapSection');
  var list = document.getElementById('gapList');
  if (!gaps.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  list.innerHTML = '';
  gaps.forEach(function(g, i) {
    var walkSec = Math.round(g.distMeters / 1.4);
    var walkMin = Math.ceil(walkSec / 60);
    var div = document.createElement('div');
    div.className = 'gap-card';
    div.style.animationDelay = (i * 60) + 'ms';
    div.innerHTML = App.t('gapLabel')(i+1, g.distMeters, walkMin);
    div.addEventListener('click', function() {
      var mid = g.points[Math.floor(g.points.length/2)];
      App.map.panTo(mid); App.map.setZoom(16);
    });
    list.appendChild(div);
  });
};

App.renderShelterList = async function(shelters, path, radius) {
  var sec = document.getElementById('shelterSection');
  var list = document.getElementById('shelterList');
  if (!shelters.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  list.innerHTML = '';

  var effectiveRadius = radius / App.WALK_FACTOR;
  var nearby = shelters
    .map(function(s) {
      var result = App.closestOnPath(s.location, path);
      return Object.assign({}, s, { routeDist: result.dist, nearestRoutePoint: result.point, pathIndex: result.pathIndex });
    })
    .filter(function(s) { return s.routeDist <= effectiveRadius * 1.5; })
    .sort(function(a, b) { return a.pathIndex - b.pathIndex; });

  var walkData = [];
  if (nearby.length) {
    var origins = nearby.map(function(s) { return s.nearestRoutePoint; });
    var dests = nearby.map(function(s) { return s.location; });
    try {
      walkData = await App.getWalkingDistances(origins, dests);
    } catch (e) {
      console.warn('Distance Matrix failed, using estimates', e);
    }
  }

  nearby.forEach(function(s, i) {
    var card = document.createElement('div');
    card.className = 's-card';
    card.id = 'scard-' + s._idx;

    var wd = walkData[i];
    var walkMin = wd
      ? Math.ceil(wd.duration.value / 60)
      : Math.ceil((s.routeDist * App.WALK_FACTOR) / 80);
    var distLabel = wd
      ? wd.distance.text
      : '~' + Math.round(s.routeDist * App.WALK_FACTOR) + 'm';

    var esc = App.escapeHtml;
    var tagsHtml = '';
    var tags = [];
    if (s.community) tags.push('<span class="s-tag community">' + App.t('communityBadge') + '</span>');
    if (s.type) tags.push('<span class="s-tag">' + esc(s.type) + '</span>');
    if (s.accessible === '\u05db\u05df') tags.push('<span class="s-tag accessible">\u267f \u05e0\u05d2\u05d9\u05e9</span>');
    if (s.filtration && s.filtration !== '\u05dc\u05dc\u05d0 \u05de\u05e2\u05e8\u05db\u05ea \u05e1\u05d9\u05e0\u05d5\u05df')
      tags.push('<span class="s-tag filtered">\ud83d\udee1 ' + esc(s.filtration) + '</span>');
    if (s.status === '\u05db\u05e9\u05d9\u05e8 \u05dc\u05e9\u05d9\u05de\u05d5\u05e9')
      tags.push('<span class="s-tag status-ok">\u05db\u05e9\u05d9\u05e8</span>');
    else if (s.status)
      tags.push('<span class="s-tag status-bad">' + esc(s.status) + '</span>');
    if (s.area) tags.push('<span class="s-tag">' + esc(String(s.area)) + ' \u05de\u05f4\u05e8</span>');
    if (tags.length) tagsHtml = '<div class="s-tags">' + tags.join('') + '</div>';

    var cardName = esc(s.addr || s.type || s.name || '');
    var notesHtml = s.notes
      ? '<div class="s-notes">' + esc(s.notes) + '</div>' : '';

    card.innerHTML =
      '<div class="s-card-row">' +
        '<div class="s-num">' + (i+1) + '</div>' +
        '<div class="s-name">' + cardName + '</div>' +
        '<div class="s-dist">' + walkMin + '\u2032 <span style="font-size:9px;color:var(--muted)">' + distLabel + '</span></div>' +
      '</div>' +
      (s.addr && s.addrEng ? '<div class="s-addr">' + esc(s.addrEng) + '</div>' : '') +
      tagsHtml +
      '<div class="s-rating" data-shelter="' + s.id + '"></div>' +
      notesHtml;

    card.style.animationDelay = Math.min(i * 50, 400) + 'ms';
    card.addEventListener('click', function() {
      App.map.panTo(s.location); App.map.setZoom(17);
      App.closeAllIW();
      if (s._iw) s._iw.open(App.map, s._marker);
      App.highlightCard(s._idx);
    });
    list.appendChild(card);
  });

  return nearby;
};

App.highlightCard = function(idx) {
  document.querySelectorAll('.s-card').forEach(function(c) {
    c.classList.toggle('active', c.id === 'scard-' + idx);
  });
  var el = document.getElementById('scard-' + idx);
  if (el) el.scrollIntoView({ behavior:'smooth', block:'nearest' });
};

App.renderStars = function(avg, max) {
  max = max || 5;
  var s = '';
  for (var i = 1; i <= max; i++) s += i <= Math.round(avg) ? '\u2605' : '\u2606';
  return s;
};

App.fetchAndDisplayRatings = async function(shelterIds) {
  if (!shelterIds.length) return;
  try {
    var res = await fetch('/api/reviews?shelters=' + shelterIds.join(','));
    if (!res.ok) return;
    var data = await res.json();
    Object.assign(App.shelterRatings, data);
    for (var id in data) {
      var info = data[id];
      var el = document.querySelector('.s-rating[data-shelter="' + id + '"]');
      if (el) {
        el.innerHTML = '<span class="s-stars">' + App.renderStars(info.avg) + '</span> ' + info.avg + ' (' + info.count + ')';
      }
    }
  } catch(e) { console.warn('ratings fetch failed', e); }
};

App.submitReview = async function(shelterId, btn) {
  if (btn.disabled) return;
  var form = btn.closest('.review-form');
  var stars = form.querySelectorAll('.star-input span.active');
  var rating = stars.length;
  if (!rating) return;
  var textarea = form.querySelector('textarea');
  var text = (textarea ? textarea.value : '').trim();
  btn.disabled = true;
  btn.textContent = '\u2026';
  try {
    var res = await fetch('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shelter_id: shelterId, rating: rating, text: text }),
    });
    if (!res.ok) throw new Error('Failed');
    if (!App.shelterRatings[shelterId]) App.shelterRatings[shelterId] = { avg: 0, count: 0, reviews: [] };
    var c = App.shelterRatings[shelterId];
    c.avg = Math.round(((c.avg * c.count) + rating) / (c.count + 1) * 10) / 10;
    c.count++;
    c.reviews.unshift({ rating: rating, text: text, date: new Date().toISOString() });
    var el = document.querySelector('.s-rating[data-shelter="' + shelterId + '"]');
    if (el) el.innerHTML = '<span class="s-stars">' + App.renderStars(c.avg) + '</span> ' + c.avg + ' (' + c.count + ')';
    btn.textContent = App.t('thankYou');
    if (textarea) textarea.value = '';
    form.querySelectorAll('.star-input span').forEach(function(s) { s.classList.remove('active'); });
  } catch(e) {
    btn.textContent = App.t('errorRetry');
    btn.disabled = false;
  }
};

App.closestOnPath = function(point, path) {
  var min = Infinity, closest = path[0], closestIdx = 0;
  for (var i = 0; i < path.length; i++) {
    var d = google.maps.geometry.spherical.computeDistanceBetween(point, path[i]);
    if (d < min) { min = d; closest = path[i]; closestIdx = i; }
  }
  return { dist: min, point: closest, pathIndex: closestIdx };
};

App.getWalkingDistances = async function(origins, destinations) {
  var service = new google.maps.DistanceMatrixService();
  var walkingData = new Array(origins.length).fill(null);
  var batchSize = 10;

  for (var i = 0; i < origins.length; i += batchSize) {
    var end = Math.min(i + batchSize, origins.length);
    var batchOrigins = origins.slice(i, end);
    var batchDests = destinations.slice(i, end);

    var result = await new Promise(function(resolve) {
      service.getDistanceMatrix({
        origins: batchOrigins,
        destinations: batchDests,
        travelMode: google.maps.TravelMode.WALKING,
      }, function(response, status) {
        resolve(status === 'OK' ? response : null);
      });
    });

    if (result) {
      for (var j = 0; j < result.rows.length; j++) {
        var element = result.rows[j].elements[j];
        if (element && element.status === 'OK') {
          walkingData[i + j] = {
            distance: element.distance,
            duration: element.duration,
          };
        }
      }
    }
  }
  return walkingData;
};

App.getPathBbox = function(path, bufDeg) {
  bufDeg = bufDeg || 0.005;
  var s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (var i = 0; i < path.length; i++) {
    var lat = path[i].lat(), lng = path[i].lng();
    if (lat < s) s = lat; if (lat > n) n = lat;
    if (lng < w) w = lng; if (lng > e) e = lng;
  }
  return { south: s-bufDeg, north: n+bufDeg, west: w-bufDeg, east: e+bufDeg };
};

App.minDistToPath = function(point, path) {
  var min = Infinity;
  for (var i = 0; i < path.length; i++) {
    var d = google.maps.geometry.spherical.computeDistanceBetween(point, path[i]);
    if (d < min) min = d;
  }
  return min;
};
