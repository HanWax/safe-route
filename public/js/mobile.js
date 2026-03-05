window.App = window.App || {};

App.SHEET_PEEK = 120;
App.SHEET_HALF = 0.45;
App.SHEET_FULL = 0.85;
App.sheetState = 'hidden';

var sheetStartY = 0;
var sheetStartTranslate = 0;

App.isMobile = function() { return window.innerWidth <= 768; };

App.setSheetPosition = function(state, animate) {
  var sheet = document.getElementById('bottomSheet');
  if (!sheet) return;
  App.sheetState = state;

  if (animate !== false) {
    sheet.classList.remove('no-transition');
  } else {
    sheet.classList.add('no-transition');
  }

  var vh = window.innerHeight;
  var translateY;
  switch (state) {
    case 'peek': translateY = vh - App.SHEET_PEEK; break;
    case 'half': translateY = vh * (1 - App.SHEET_HALF); break;
    case 'full': translateY = vh * (1 - App.SHEET_FULL); break;
    default:     translateY = vh; break;
  }
  sheet.style.transform = 'translateY(' + translateY + 'px)';

  var content = document.getElementById('bottomSheetContent');
  if (content) content.style.overflowY = (state === 'full' || state === 'half') ? 'auto' : 'hidden';
};

App.initBottomSheet = function() {
  var handle = document.getElementById('dragHandle');
  var sheet = document.getElementById('bottomSheet');
  if (!handle || !sheet) return;

  var dragging = false;

  handle.addEventListener('touchstart', function(e) {
    dragging = true;
    sheetStartY = e.touches[0].clientY;
    var transform = getComputedStyle(sheet).transform;
    var matrix = new DOMMatrix(transform);
    sheetStartTranslate = matrix.m42;
    sheet.classList.add('no-transition');
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    var dy = e.touches[0].clientY - sheetStartY;
    var newY = Math.max(window.innerHeight * (1 - App.SHEET_FULL), sheetStartTranslate + dy);
    sheet.style.transform = 'translateY(' + newY + 'px)';
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('no-transition');

    var transform = getComputedStyle(sheet).transform;
    var matrix = new DOMMatrix(transform);
    var currentY = matrix.m42;
    var vh = window.innerHeight;

    var peekY = vh - App.SHEET_PEEK;
    var halfY = vh * (1 - App.SHEET_HALF);
    var fullY = vh * (1 - App.SHEET_FULL);

    var targets = [
      { state: 'full', y: fullY },
      { state: 'half', y: halfY },
      { state: 'peek', y: peekY },
    ];

    var closest = targets[0];
    for (var i = 0; i < targets.length; i++) {
      if (Math.abs(currentY - targets[i].y) < Math.abs(currentY - closest.y)) closest = targets[i];
    }

    if (currentY > peekY + 50) {
      App.setSheetPosition('hidden');
    } else {
      App.setSheetPosition(closest.state);
    }
  });

  App.setSheetPosition('hidden', false);

  // Show welcome content in bottom sheet
  App.showMobileWelcome();
};

App.showMobileWelcome = function() {
  var content = document.getElementById('bottomSheetContent');
  if (!content) return;
  content.innerHTML =
    '<div style="text-align:center;padding:8px 0 4px">' +
      '<div style="font-size:11px;color:var(--ink);line-height:1.7;max-width:260px;margin:0 auto">' +
        App.t('emptyWhat') +
      '</div>' +
      '<div style="margin-top:14px;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);font-weight:500">' +
        App.t('tryExample') +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">' +
        '<button class="example-chip" onclick="App.loadExample(\'tlv\')">' + App.t('exampleTlv') + '</button>' +
        '<button class="example-chip" onclick="App.loadExample(\'jer\')">' + App.t('exampleJer') + '</button>' +
        '<button class="example-chip" onclick="App.loadExample(\'haifa\')">' + App.t('exampleHaifa') + '</button>' +
      '</div>' +
    '</div>';
  App.setSheetPosition('peek');
};

App.syncInputs = function() {
  if (!App.isMobile()) return;
  var mo = document.getElementById('mobileOrigin');
  var md = document.getElementById('mobileDest');
  var mr = document.getElementById('mobileRadius');
  if (mo) document.getElementById('origin').value = mo.value;
  if (md) document.getElementById('dest').value = md.value;
  if (mr) document.getElementById('radius').value = mr.value;
};

App.setMobileStatus = function(msg, type) {
  var el = document.getElementById('mobileStatusBar');
  if (el) {
    el.textContent = msg;
    el.className = 'mobile-status' + (type ? ' ' + type : '');
  }
};

App.initMobileSettings = function() {
  var toggle = document.getElementById('mobileSettingsToggle');
  var panel = document.getElementById('mobileSettingsPanel');
  if (!toggle || !panel) return;
  toggle.addEventListener('click', function() {
    var isOpen = panel.classList.toggle('open');
    toggle.classList.toggle('open', isOpen);
  });
};

App._dedupeClone = function(clone, prefix) {
  clone.querySelectorAll('[id]').forEach(function(el) {
    el.id = prefix + el.id;
  });
};

App.populateBottomSheet = function() {
  var content = document.getElementById('bottomSheetContent');
  if (!content) return;

  content.innerHTML = '';

  var scoreWrap = document.getElementById('scoreWrap');
  if (scoreWrap) {
    var clone = scoreWrap.cloneNode(true);
    App._dedupeClone(clone, 'mb-');
    clone.id = 'mobileScoreWrap';
    clone.classList.add('show');
    content.appendChild(clone);
  }

  var dragHint = document.getElementById('dragHint');
  if (dragHint && dragHint.classList.contains('show')) {
    var clone = dragHint.cloneNode(true);
    clone.id = 'mobileDragHint';
    content.appendChild(clone);
  }

  var shelterSection = document.getElementById('shelterSection');
  if (shelterSection && shelterSection.style.display !== 'none') {
    var clone = shelterSection.cloneNode(true);
    App._dedupeClone(clone, 'mb-');
    clone.id = 'mobileShelterSection';
    var mobileToggle = clone.querySelector('.section-head--toggle');
    var mobileList = clone.querySelector('.shelter-list-collapsible');
    if (mobileToggle && mobileList) {
      mobileToggle.addEventListener('click', function() {
        var isOpen = mobileList.classList.toggle('open');
        mobileToggle.classList.toggle('open', isOpen);
      });
    }
    clone.querySelectorAll('.s-card').forEach(function(card) {
      var origId = card.id.replace('mb-', '');
      card.addEventListener('click', function() {
        var origCard = document.getElementById(origId);
        if (origCard) origCard.click();
        App.setSheetPosition('peek');
      });
    });
    content.appendChild(clone);
  }

  // Move legend into bottom sheet on mobile
  var legend = document.getElementById('legend');
  if (legend && legend.classList.contains('show')) {
    var legendClone = legend.cloneNode(true);
    App._dedupeClone(legendClone, 'mb-');
    legendClone.id = 'mobileLegend';
    legendClone.classList.add('mobile-legend-inline');
    content.appendChild(legendClone);
  }
};
