window.App = window.App || {};

App.WALK_FACTOR = 1.3;

App.CITY_CONFIGS = [
  {
    id: 'tel-aviv',
    name: 'Tel Aviv-Yafo',
    nameHe: '\u05ea\u05dc \u05d0\u05d1\u05d9\u05d1-\u05d9\u05e4\u05d5',
    center: { lat: 32.08, lng: 34.78 },
    queryUrl: 'https://gisn.tel-aviv.gov.il/arcgis/rest/services/IView2/MapServer/592/query',
    outFields: ['oid_mitkan','ms_miklat','t_sug','Full_Address','shem_rechov_eng','shetach_mr','t_sinon','hearot','lon','lat','pail','opening_times','is_open','miklat_mungash','shem'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = a.lat || g.y, lon = a.lon || g.x;
      if (!lat || !lon) return null;
      return {
        id: 'tlv-' + a.oid_mitkan, ms_miklat: a.ms_miklat, lat: lat, lon: lon,
        name: a.shem || a.t_sug || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.t_sug || '',
        addr: a.Full_Address || '', addrEng: (a.shem_rechov_eng || '').trim(),
        area: a.shetach_mr || 0, filtration: a.t_sinon || '', notes: a.hearot || '',
        status: a.pail || '', openingTimes: a.opening_times || '', isOpen: a.is_open || '',
        accessible: (a.miklat_mungash || '').trim(),
      };
    },
  },
  {
    id: 'ramat-gan',
    name: 'Ramat Gan',
    nameHe: '\u05e8\u05de\u05ea \u05d2\u05df',
    center: { lat: 32.08, lng: 34.82 },
    staticUrl: '/api/ramat-gan-shelters',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'rg-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.address || '', addrEng: '',
        area: 0, filtration: '', notes: a.dynamicField || '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'givatayim',
    name: 'Givatayim',
    nameHe: '\u05d2\u05d1\u05e2\u05ea\u05d9\u05d9\u05dd',
    center: { lat: 32.07, lng: 34.81 },
    staticUrl: '/api/givatayim-shelters',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'giv-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.type || '',
        addr: a.address || '', addrEng: '',
        area: 0, filtration: '', notes: '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'beer-sheva',
    name: "Be'er Sheva",
    nameHe: '\u05d1\u05d0\u05e8 \u05e9\u05d1\u05e2',
    center: { lat: 31.25, lng: 34.79 },
    queryUrl: 'https://opendatagis.br7.org.il/arcgis/rest/services/Hosted/shelters/FeatureServer/0/query',
    outFields: ['*'],
    useProxy: true,
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'bs-' + (a.OBJECTID || a.FID), lat: lat, lon: lon,
        name: a.Name || a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.Type || a.type || '',
        addr: a.Address || a.address || '', addrEng: '',
        area: 0, filtration: '', notes: '', status: '', accessible: '',
      };
    },
  },
  {
    id: 'haifa',
    name: 'Haifa',
    nameHe: '\u05d7\u05d9\u05e4\u05d4',
    center: { lat: 32.79, lng: 34.99 },
    queryUrl: 'https://services9.arcgis.com/tfeLX7LFVABzD11G/arcgis/rest/services/\u05de\u05e8\u05d7\u05d1\u05d9\u05dd/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'haifa-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.PlaceName || '\u05de\u05e8\u05d7\u05d1 \u05de\u05d5\u05d2\u05df', type: a.SUG || '',
        addr: a.Address || '', addrEng: '',
        area: a.KIBOLET || 0, filtration: '', notes: a.dothliti || '',
        status: a.Activated || '', accessible: a.Accessable || '',
      };
    },
  },
  {
    id: 'nahariya',
    name: 'Nahariya',
    nameHe: '\u05e0\u05d4\u05e8\u05d9\u05d4',
    center: { lat: 33.01, lng: 35.09 },
    queryUrl: 'https://services-eu1.arcgis.com/mFG6VsJiT6hDsVLu/arcgis/rest/services/\u05e0\u05d4\u05e8\u05d9\u05d4_\u05de\u05e7\u05dc\u05d8\u05d9\u05dd_\u05e6\u05d9\u05d1\u05d5\u05e8\u05d9\u05d9\u05dd/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'nah-' + (a.OBJECTID || a.FID), lat: lat, lon: lon,
        name: a.FNAME || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '', addr: a.LATIN_NAME || '', addrEng: a.LATIN_NAME || '',
        area: 0, filtration: '', notes: '', status: '', accessible: '',
      };
    },
  },
  {
    id: 'ashkelon',
    name: 'Ashkelon',
    nameHe: '\u05d0\u05e9\u05e7\u05dc\u05d5\u05df',
    center: { lat: 31.67, lng: 34.57 },
    queryUrl: 'https://services2.arcgis.com/5gNmRQS5QY72VLq4/arcgis/rest/services/PUBLIC_SHELTER/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'ash-' + (a.OBJECTID || a.FID), lat: lat, lon: lon,
        name: a.NAME_HEB || a.NAME_ENG || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a['\u05e1\u05d5\u05d2_\u05d4'] || '',
        addr: a['\u05db\u05ea\u05d5\u05d1\u05ea'] || '', addrEng: a.NAME_ENG || '',
        area: a['\u05d2\u05d5\u05d3\u05dc_'] || 0, filtration: '', notes: a['\u05dc\u05d9\u05d3'] || '',
        status: a['\u05de\u05e6\u05d1'] || '', accessible: '',
      };
    },
  },
  {
    id: 'modiin',
    name: "Modi'in",
    nameHe: '\u05de\u05d5\u05d3\u05d9\u05e2\u05d9\u05df',
    center: { lat: 31.89, lng: 35.01 },
    queryUrl: 'https://webgis.modiin.muni.il/arcgis/rest/services/GeoShelter102023/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'mod-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.Place || a.NUMBER || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.Place || '', addrEng: '',
        area: 0, filtration: '', notes: '', status: '', accessible: '',
      };
    },
  },
  {
    id: 'petach-tikva',
    name: 'Petach Tikva',
    nameHe: '\u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4',
    center: { lat: 32.09, lng: 34.88 },
    queryUrl: 'https://services9.arcgis.com/tfeLX7LFVABzD11G/arcgis/rest/services/\u05de\u05e7\u05dc\u05d8\u05d9\u05dd_\u05d5\u05de\u05d7\u05e1\u05d5\u05ea_\u05dc\u05d0\u05d2\u05d5\u05dc/FeatureServer/179/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'pt-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.PlaceName || '\u05de\u05e7\u05dc\u05d8', type: a.SUG || '',
        addr: a.Address || '', addrEng: '',
        area: a.KIBOLET || 0, filtration: '', notes: '',
        status: a.Activated || '', accessible: a.Accessable || '',
      };
    },
  },
  {
    id: 'jerusalem',
    name: 'Jerusalem',
    nameHe: '\u05d9\u05e8\u05d5\u05e9\u05dc\u05d9\u05dd',
    center: { lat: 31.77, lng: 35.21 },
    staticUrl: '/api/jerusalem-shelters',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'jer-' + a.OBJECTID, lat: lat, lon: lon,
        name: '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '', addr: '', addrEng: '',
        area: 0, filtration: '', notes: '',
        status: '', accessible: '', ms_miklat: a.MIS_MIKLAT || '',
      };
    },
  },
  {
    id: 'kfar-saba',
    name: 'Kfar Saba',
    nameHe: '\u05db\u05e4\u05e8 \u05e1\u05d1\u05d0',
    center: { lat: 32.18, lng: 34.91 },
    queryUrl: 'https://services2.arcgis.com/CrAWtmFzBf9b3nM0/arcgis/rest/services/HlsFacilities/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'ks-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.NAME || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.SUG || '',
        addr: a.STR_NAME ? (a.STR_NAME + ' ' + (a.NUM || '')).trim() : '',
        addrEng: '', area: a.AREA1 || 0, filtration: '', notes: a.Remark || '',
        status: '', accessible: '', capacity: a.PEOPLE || 0,
      };
    },
  },
  {
    id: 'nes-ziona',
    name: 'Nes Ziona',
    nameHe: '\u05e0\u05e1 \u05e6\u05d9\u05d5\u05e0\u05d4',
    center: { lat: 31.93, lng: 34.80 },
    queryUrl: 'https://services-eu1.arcgis.com/1SaThKhnIOL6Cfhz/arcgis/rest/services/miklatim/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'nz-' + (a.OBJECTID || a.FID), lat: lat, lon: lon,
        name: a.Name || a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.Address || a.address || '', addrEng: '',
        area: 0, filtration: '', notes: '', status: '', accessible: '',
      };
    },
  },
  {
    id: 'herzliya',
    name: 'Herzliya',
    nameHe: '\u05d4\u05e8\u05e6\u05dc\u05d9\u05d4',
    center: { lat: 32.16, lng: 34.84 },
    queryUrl: 'https://services3.arcgis.com/9qGhZGtb39XMVQyR/ArcGIS/rest/services/Layers_agol/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'hrz-' + a.OBJECTID, lat: lat, lon: lon,
        name: a['\u05ea\u05d9\u05d0\u05d5\u05e8'] || a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9',
        type: a['\u05e1\u05d5\u05d2'] || '',
        addr: a['\u05db\u05ea\u05d5\u05d1\u05ea'] || '', addrEng: a.name || '',
        area: 0, filtration: '', notes: '',
        status: '', accessible: a.negishot || '',
      };
    },
  },
  {
    id: 'raanana',
    name: "Ra'anana",
    nameHe: '\u05e8\u05e2\u05e0\u05e0\u05d4',
    center: { lat: 32.18, lng: 34.87 },
    queryUrl: 'https://services5.arcgis.com/PtYt6sZAX61iaSv2/arcgis/rest/services/Bublic_Shelters/FeatureServer/1/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'rnn-' + (a.OBJECTID_1 || a.OBJECTID), lat: lat, lon: lon,
        name: '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.type || '',
        addr: a.adress || '', addrEng: '',
        area: a.M_Area || 0, filtration: '', notes: a.remarks || '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'rosh-haayin',
    name: 'Rosh HaAyin',
    nameHe: '\u05e8\u05d0\u05e9 \u05d4\u05e2\u05d9\u05df',
    center: { lat: 32.10, lng: 34.96 },
    queryUrl: 'https://services2.arcgis.com/LRSgLpRWTkMT0jqN/arcgis/rest/services/miklat_bh/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'rha-' + (a.FID || a.Id), lat: lat, lon: lon,
        name: a.place || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.adress || '', addrEng: '',
        area: a.area || 0, filtration: '', notes: a['\u05d4\u05e2\u05e8\u05d5\u05ea'] || '',
        status: '', accessible: '', capacity: a.p_max || 0,
      };
    },
  },
  {
    id: 'holon',
    name: 'Holon',
    nameHe: '\u05d7\u05d5\u05dc\u05d5\u05df',
    center: { lat: 32.02, lng: 34.77 },
    queryUrl: 'https://services2.arcgis.com/cjDo9oPmimdHxumn/arcgis/rest/services/\u05de\u05e7\u05dc\u05d8\u05d9\u05dd/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'hln-' + a.OBJECTID, lat: lat, lon: lon,
        name: '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.ADDRESS || '', addrEng: '',
        area: a.area || 0, filtration: '', notes: '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'eilat',
    name: 'Eilat',
    nameHe: '\u05d0\u05d9\u05dc\u05ea',
    center: { lat: 29.56, lng: 34.95 },
    queryUrl: 'https://services5.arcgis.com/ovf8inh98nWtTVI9/arcgis/rest/services/EilatShelters/FeatureServer/0/query',
    outFields: ['*'],
    inSR: '2039',
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'eil-' + a.OBJECTID, lat: lat, lon: lon,
        name: a.ShelterName || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.ShelterAddress || '', addrEng: '',
        area: a.ShelterSize || 0, filtration: '', notes: a.Comments || '',
        status: a.ShelterConditionStatus || '', accessible: '',
        capacity: a.ShelterCapacity || 0,
      };
    },
  },
  {
    id: 'akko',
    name: 'Akko',
    nameHe: '\u05e2\u05db\u05d5',
    center: { lat: 32.93, lng: 35.08 },
    queryUrl: 'https://services8.arcgis.com/GY0eO9hmNflcIYdR/arcgis/rest/services/\u05de\u05e7\u05dc\u05d8\u05d9\u05dd_\u05e6\u05d9\u05d1\u05d5\u05e8\u05d9\u05d9\u05dd/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'akk-' + a.FID, lat: lat, lon: lon,
        name: a.Type_of_shelter || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: a.Type_of_shelter || '',
        addr: a.address || '', addrEng: '',
        area: 0, filtration: '', notes: a.notes || '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'yeruham',
    name: 'Yeruham',
    nameHe: '\u05d9\u05e8\u05d5\u05d7\u05dd',
    center: { lat: 30.99, lng: 34.93 },
    queryUrl: 'https://services8.arcgis.com/o9mRsTJvcMg9lfkv/arcgis/rest/services/\u05de\u05e7\u05dc\u05d8\u05d9\u05dd/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'yer-' + a.OBJECTID, lat: lat, lon: lon,
        name: a['\u05db\u05ea\u05d5\u05d1\u05ea'] || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9',
        type: a['\u05ea\u05ea_\u05e7\u05e8'] || '',
        addr: a['\u05db\u05ea\u05d5\u05d1\u05ea'] || '', addrEng: '',
        area: a['\u05e9\u05d8\u05d7__\u05d1'] || 0, filtration: '', notes: '',
        status: '', accessible: '',
      };
    },
  },
  {
    id: 'beit-shemesh',
    name: 'Beit Shemesh',
    nameHe: '\u05d1\u05d9\u05ea \u05e9\u05de\u05e9',
    center: { lat: 31.75, lng: 34.99 },
    queryUrl: 'https://services7.arcgis.com/hxagH6f3Qa2NldQ6/arcgis/rest/services/emergency_WFL1/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'bsh-' + a.FID, lat: lat, lon: lon,
        name: '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.ctovet || '', addrEng: '',
        area: 0, filtration: '', notes: a.hearot || '',
        status: a.use_ || '', accessible: '',
      };
    },
  },
  {
    id: 'kiryat-malakhi',
    name: 'Kiryat Malakhi',
    nameHe: '\u05e7\u05e8\u05d9\u05ea \u05de\u05dc\u05d0\u05db\u05d9',
    center: { lat: 31.73, lng: 34.74 },
    queryUrl: 'https://services3.arcgis.com/XBDMqmX1PKcVQCKG/arcgis/rest/services/\u05de\u05e7\u05dc\u05d8\u05d9\u05dd_\u05ea\u05e6\u05d5\u05d2\u05d41/FeatureServer/0/query',
    outFields: ['*'],
    parseFeat: function(feat) {
      var a = feat.attributes, g = feat.geometry;
      var lat = g.y, lon = g.x;
      if (!lat || !lon) return null;
      return {
        id: 'km-' + a.OBJECTID_1, lat: lat, lon: lon,
        name: a.name || '\u05de\u05e7\u05dc\u05d8 \u05e6\u05d9\u05d1\u05d5\u05e8\u05d9', type: '',
        addr: a.Adress || '', addrEng: '',
        area: a.area || 0, filtration: '', notes: '',
        status: a.resulys || '', accessible: '',
      };
    },
  },
];

App.detectCity = function(routePath) {
  var cities = App.detectCities(routePath);
  return cities[0] || App.CITY_CONFIGS[0];
};

App.detectCities = function(routePath) {
  if (!routePath || !routePath.length) return [App.CITY_CONFIGS[0]];

  // Compute route bounding box
  var s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
  for (var i = 0; i < routePath.length; i++) {
    var lat = routePath[i].lat(), lng = routePath[i].lng();
    if (lat < s) s = lat; if (lat > n) n = lat;
    if (lng < w) w = lng; if (lng > e) e = lng;
  }

  // ~5km buffer in degrees
  var buf = 0.045;
  s -= buf; n += buf; w -= buf; e += buf;

  var matches = [];
  for (var j = 0; j < App.CITY_CONFIGS.length; j++) {
    var cfg = App.CITY_CONFIGS[j];
    if (cfg.center.lat >= s && cfg.center.lat <= n &&
        cfg.center.lng >= w && cfg.center.lng <= e) {
      matches.push(cfg);
    }
  }

  if (!matches.length) {
    // Fallback: pick the single nearest city
    var mid = routePath[Math.floor(routePath.length / 2)];
    var midLat = mid.lat(), midLng = mid.lng();
    var best = null, bestDist = Infinity;
    for (var k = 0; k < App.CITY_CONFIGS.length; k++) {
      var c = App.CITY_CONFIGS[k];
      var d = Math.sqrt(Math.pow(midLat - c.center.lat, 2) + Math.pow(midLng - c.center.lng, 2));
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return [best];
  }

  return matches;
};
