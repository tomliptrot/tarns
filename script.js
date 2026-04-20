var OS_API_KEY = "vt6TzPGU43fdeK6Pjg52sbWXshKSrxB5";

var crs = new L.Proj.CRS('EPSG:27700',
  '+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m +no_defs',
  {
    resolutions: [896.0, 448.0, 224.0, 112.0, 56.0, 28.0, 14.0, 7.0, 3.5, 1.75, 0.875, 0.4375, 0.21875, 0.109375],
    origin: [-238375.0, 1376256.0]
  }
);

var map = L.map("map", {
  crs: crs,
  minZoom: 0,
  maxZoom: 9,
  center: [57.1, -3.7],
  zoom: 1
});

map.on("zoomend", function () {
  console.log("Zoom level:", map.getZoom());
});

var osAttribution = "Contains OS data &copy; Crown copyright and database right 2026";

var osOutdoor = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Outdoor_27700/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 13 }
);

var osLeisure = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Leisure_27700/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 9 }
).addTo(map);

var osLight = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Light_27700/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 13 }
);

var osRoad = L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Road_27700/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 13 }
);

L.control.layers({
  "OS Outdoor": osOutdoor,
  "OS Leisure": osLeisure,
  "OS Light": osLight,
  "OS Road": osRoad,
}).addTo(map);

var allMarkers = [];
var imperial = false;

// Conversion factors
var M_TO_FT = 3.28084;
var M_TO_YD = 1.09361;
var HA_TO_ACRES = 2.47105;

function isImperial() {
  return document.querySelector('input[name="units"]:checked').value === "imperial";
}

function formatTooltip(row) {
  if (isImperial()) {
    return "<b>" + row.name + "</b><br>" +
      "Elevation: " + Math.round(row.elevation * M_TO_FT) + " ft<br>" +
      "Area: " + (row.area_hectares * HA_TO_ACRES).toFixed(2) + " acres<br>" +
      "Length: " + Math.round(row.length_m * M_TO_YD) + " yd";
  }
  return "<b>" + row.name + "</b><br>" +
    "Elevation: " + row.elevation + " m<br>" +
    "Area: " + row.area_hectares + " ha<br>" +
    "Length: " + row.length_m + " m";
}

fetch("scottish_high_lochs.csv")
  .then(function (response) { return response.text(); })
  .then(function (text) {
    var result = Papa.parse(text, { header: true, dynamicTyping: true });
    var rows = result.data.filter(function (r) { return r.lat != null; });

    rows.forEach(function (row) {
      var marker = L.circleMarker([row.lat, row.lon], {
        radius: 5,
        color: "blue",
        fillOpacity: 0.8,
        weight: 1,
      });

      marker.bindTooltip(formatTooltip(row));
      marker.on("click", function () {
        map.setView([row.lat, row.lon], 7);
      });
      marker.addTo(map);

      allMarkers.push({ marker: marker, row: row, elevation: row.elevation, length_m: row.length_m });
    });

    document.getElementById("total").textContent = allMarkers.length;
    updateSliderRanges();
    // Restore desired defaults after range update
    document.getElementById("elev-min").value = 500;
    document.getElementById("len-min").value = 300;
    applyFilters();

    document.getElementById("elev-min").addEventListener("input", applyFilters);
    document.getElementById("len-min").addEventListener("input", applyFilters);

    document.querySelectorAll('input[name="units"]').forEach(function (radio) {
      radio.addEventListener("change", onUnitsChange);
    });
  });

function updateSliderRanges() {
  var elevMin = Infinity, elevMax = -Infinity;
  var lenMin = Infinity, lenMax = -Infinity;

  allMarkers.forEach(function (item) {
    if (item.elevation < elevMin) elevMin = item.elevation;
    if (item.elevation > elevMax) elevMax = item.elevation;
    if (item.length_m < lenMin) lenMin = item.length_m;
    if (item.length_m > lenMax) lenMax = item.length_m;
  });

  var elevSlider = document.getElementById("elev-min");
  var lenSlider = document.getElementById("len-min");

  if (isImperial()) {
    elevSlider.min = 0;
    elevSlider.max = Math.ceil(elevMax * M_TO_FT);
    elevSlider.step = 50;
    lenSlider.min = 0;
    lenSlider.max = Math.ceil(lenMax * M_TO_YD);
    lenSlider.step = 10;
    document.getElementById("elev-unit").textContent = "ft";
    document.getElementById("len-unit").textContent = "yd";
  } else {
    elevSlider.min = 0;
    elevSlider.max = Math.ceil(elevMax);
    elevSlider.step = 10;
    lenSlider.min = 0;
    lenSlider.max = Math.ceil(lenMax);
    lenSlider.step = 10;
    document.getElementById("elev-unit").textContent = "m";
    document.getElementById("len-unit").textContent = "m";
  }
}

function onUnitsChange() {
  // Convert current slider positions to the new unit
  var elevSlider = document.getElementById("elev-min");
  var lenSlider = document.getElementById("len-min");
  var oldElevVal = +elevSlider.value;
  var oldLenVal = +lenSlider.value;

  var imp = isImperial();

  // Convert slider value: if switching to imperial, old value is metres; if to metric, old is ft/yd
  var newElevVal = imp ? Math.round(oldElevVal * M_TO_FT) : Math.round(oldElevVal / M_TO_FT);
  var newLenVal = imp ? Math.round(oldLenVal * M_TO_YD) : Math.round(oldLenVal / M_TO_YD);

  updateSliderRanges();

  elevSlider.value = newElevVal;
  lenSlider.value = newLenVal;

  // Update tooltips
  allMarkers.forEach(function (item) {
    item.marker.setTooltipContent(formatTooltip(item.row));
  });

  applyFilters();
}

function applyFilters() {
  var eSliderVal = +document.getElementById("elev-min").value;
  var lSliderVal = +document.getElementById("len-min").value;

  document.getElementById("elev-val").textContent = eSliderVal;
  document.getElementById("len-val").textContent = lSliderVal;

  // Convert slider values back to metric for comparison against data
  var eMin = isImperial() ? eSliderVal / M_TO_FT : eSliderVal;
  var lMin = isImperial() ? lSliderVal / M_TO_YD : lSliderVal;

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
