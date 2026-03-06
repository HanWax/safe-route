// Static Givat Shmuel shelter data (extracted from municipality PDF)
// Source: https://www.givat-shmuel.muni.il/uploads/n/1620769813.4504.pdf
// HaNasi street coordinates interpolated along street geometry (SE→NW)
const data = {"features":[
  {"attributes":{"OBJECTID":1,"name":"שלוחת המתנ\"ס","address":"הנשיא 1-4","area":100},"geometry":{"x":34.8530,"y":32.0807}},
  {"attributes":{"OBJECTID":2,"name":"מדרש שמואל","address":"הנשיא 5-8","area":128},"geometry":{"x":34.8518,"y":32.0812}},
  {"attributes":{"OBJECTID":3,"name":"בית מדרש","address":"הנשיא 9-12","area":100},"geometry":{"x":34.8505,"y":32.0816}},
  {"attributes":{"OBJECTID":4,"name":"בית אל","address":"הנשיא 13/14","area":100},"geometry":{"x":34.8492,"y":32.0820}},
  {"attributes":{"OBJECTID":5,"name":"בי\"כ צרפתים","address":"הנשיא 17","area":120},"geometry":{"x":34.8482,"y":32.0823}},
  {"attributes":{"OBJECTID":6,"name":"מרכז התחלות","address":"הנשיא 18","area":120},"geometry":{"x":34.8477,"y":32.0825}},
  {"attributes":{"OBJECTID":7,"name":"קידום נוער","address":"הזיתים פינת בארי","area":100},"geometry":{"x":34.8523,"y":32.0799}},
  {"attributes":{"OBJECTID":8,"name":"יד-לבנים","address":"שד׳ הגיבורים","area":70},"geometry":{"x":34.8490,"y":32.0760}},
  {"attributes":{"OBJECTID":9,"name":"גן גולני","address":"הרצל 4","area":150},"geometry":{"x":34.8493,"y":32.0745}},
  {"attributes":{"OBJECTID":10,"name":"שופר סל","address":"בן גוריון 18","area":150},"geometry":{"x":34.8475,"y":32.0790}},
  {"attributes":{"OBJECTID":11,"name":"בוטיק הגבעה","address":"העבודה 1","area":100},"geometry":{"x":34.8512,"y":32.0781}}
]};

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate');
  res.status(200).json(data);
}
