var OS_API_KEY = "vt6TzPGU43fdeK6Pjg52sbWXshKSrxB5";

var map = L.map("map").setView([57.1, -3.7], 8);

var osAttribution = "Contains OS data &copy; Crown copyright and database right 2026";

var osOutdoor = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 20 }
).addTo(map);

var osLight = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Light_3857/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 20 }
);

var osRoad = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Road_3857/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 20 }
);

var satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "&copy; Esri, Maxar, Earthstar Geographics", maxZoom: 19 }
);

L.control.layers({
  "OS Outdoor": osOutdoor,
  "OS Light": osLight,
  "OS Road": osRoad,
  "Satellite": satellite,
}).addTo(map);

var allMarkers = [];

fetch("scottish_high_lochs.csv")
  .then(function (response) { return response.text(); })
  .then(function (text) {
    var result = Papa.parse(text, { header: true, dynamicTyping: true });
    var rows = result.data.filter(function (r) { return r.lat != null; });

    var elevMin = Infinity, elevMax = -Infinity;
    var lenMin = Infinity, lenMax = -Infinity;

    rows.forEach(function (row) {
      var marker = L.circleMarker([row.lat, row.lon], {
        radius: 5,
        color: "blue",
        fillOpacity: 0.8,
        weight: 1,
      });

      marker.bindTooltip(
        "<b>" + row.name + "</b><br>" +
        "Elevation: " + row.elevation + " m<br>" +
        "Area: " + row.area_hectares + " ha<br>" +
        "Length: " + row.length_m + " m"
      );

      marker.addTo(map);

      allMarkers.push({ marker: marker, row: row, elevation: row.elevation, length_m: row.length_m });

      if (row.elevation < elevMin) elevMin = row.elevation;
      if (row.elevation > elevMax) elevMax = row.elevation;
      if (row.length_m < lenMin) lenMin = row.length_m;
      if (row.length_m > lenMax) lenMax = row.length_m;
    });

    // Set slider ranges from data
    var elevSlider = document.getElementById("elev-min");
    var lenSlider = document.getElementById("len-min");

    elevSlider.min = Math.floor(elevMin);
    elevSlider.max = Math.ceil(elevMax);
    elevSlider.value = elevSlider.min;

    lenSlider.min = Math.floor(lenMin);
    lenSlider.max = Math.ceil(lenMax);
    lenSlider.value = lenSlider.min;

    document.getElementById("total").textContent = allMarkers.length;

    applyFilters();

    elevSlider.addEventListener("input", applyFilters);
    lenSlider.addEventListener("input", applyFilters);
  });

function applyFilters() {
  var eMin = +document.getElementById("elev-min").value;
  var lMin = +document.getElementById("len-min").value;

  document.getElementById("elev-val").textContent = eMin;
  document.getElementById("len-val").textContent = lMin;

  var shown = 0;
  allMarkers.forEach(function (item) {
    var keep = item.elevation >= eMin && item.length_m >= lMin;
    if (keep) {
      if (!map.hasLayer(item.marker)) map.addLayer(item.marker);
      shown++;
    } else {
      if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
    }
  });

  document.getElementById("count").textContent = shown;
}

function exportCSV() {
  var visible = allMarkers.filter(function (item) {
    return map.hasLayer(item.marker);
  });

  if (visible.length === 0) return;

  var columns = Object.keys(visible[0].row);
  var lines = [columns.join(",")];

  visible.forEach(function (item) {
    var values = columns.map(function (col) {
      var val = item.row[col];
      if (typeof val === "string" && (val.indexOf(",") !== -1 || val.indexOf('"') !== -1)) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    });
    lines.push(values.join(","));
  });

  var blob = new Blob([lines.join("\n")], { type: "text/csv" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "scottish_high_lochs_filtered.csv";
  a.click();
  URL.revokeObjectURL(url);
}
