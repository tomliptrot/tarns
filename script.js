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
  center: [55, -2.0],
  zoom: 0
});

map.on("zoomend", function () {
  console.log("Zoom level:", map.getZoom());
});

var osAttribution = "Contains OS data &copy; Crown copyright and database right 2026";

L.tileLayer(
  "https://api.os.uk/maps/raster/v1/zxy/Leisure_27700/{z}/{x}/{y}.png?key=" + OS_API_KEY,
  { attribution: osAttribution, maxZoom: 9 }
).addTo(map);

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

fetch("high_lochs.csv")
  .then(function (response) { return response.text(); })
  .then(function (text) {
    var result = Papa.parse(text, { header: true, dynamicTyping: true });
    var rows = result.data.filter(function (r) {
      if (r.lat == null) return false;
      // Exclude rivers (area < 1ha and length > 800m)
      if (r.area_hectares < 1 && r.length_m > 800) return false;
      return true;
    });

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

      allMarkers.push({ marker: marker, row: row, elevation: row.elevation, length_m: row.length_m, area_hectares: row.area_hectares });
    });

    document.getElementById("total").textContent = allMarkers.length;
    initDataTable();
    updateSliderRanges();
    // Restore desired defaults after range update (imperial)
    document.getElementById("elev-min").value = 1500;
    document.getElementById("area-min").value = 15;
    document.getElementById("elev-min-2").value = 2000;
    document.getElementById("area-min-2").value = 10;
    applyFilters();

    ["elev-min", "area-min", "elev-min-2", "area-min-2"].forEach(function (id) {
      document.getElementById(id).addEventListener("input", applyFilters);
    });

    document.querySelectorAll('input[name="units"]').forEach(function (radio) {
      radio.addEventListener("change", onUnitsChange);
    });
  });

function updateSliderRanges() {
  var elevMin = Infinity, elevMax = -Infinity;

  allMarkers.forEach(function (item) {
    if (item.elevation < elevMin) elevMin = item.elevation;
    if (item.elevation > elevMax) elevMax = item.elevation;
  });

  var elevSliders = [document.getElementById("elev-min"), document.getElementById("elev-min-2")];
  var areaSliders = [document.getElementById("area-min"), document.getElementById("area-min-2")];

  if (isImperial()) {
    elevSliders.forEach(function (s) { s.min = 0; s.max = Math.ceil(elevMax * M_TO_FT); s.step = 50; });
    areaSliders.forEach(function (s) { s.min = 0; s.max = +(10 * HA_TO_ACRES).toFixed(1); s.step = 0.1; });
    document.getElementById("elev-unit").textContent = "ft";
    document.getElementById("elev-unit-2").textContent = "ft";
    document.getElementById("area-unit").textContent = "acres";
    document.getElementById("area-unit-2").textContent = "acres";
  } else {
    elevSliders.forEach(function (s) { s.min = 0; s.max = Math.ceil(elevMax); s.step = 10; });
    areaSliders.forEach(function (s) { s.min = 0; s.max = 10; s.step = 0.1; });
    document.getElementById("elev-unit").textContent = "m";
    document.getElementById("elev-unit-2").textContent = "m";
    document.getElementById("area-unit").textContent = "ha";
    document.getElementById("area-unit-2").textContent = "ha";
  }
}

function onUnitsChange() {
  // Convert current slider positions to the new unit
  var imp = isImperial();

  // Convert slider value: if switching to imperial, old value is metric; if to metric, old is imperial
  function convElev(v) { return imp ? Math.round(v * M_TO_FT) : Math.round(v / M_TO_FT); }
  function convArea(v) { return imp ? +(v * HA_TO_ACRES).toFixed(1) : +(v / HA_TO_ACRES).toFixed(1); }

  var elevIds = ["elev-min", "elev-min-2"];
  var areaIds = ["area-min", "area-min-2"];
  var oldElev = elevIds.map(function (id) { return +document.getElementById(id).value; });
  var oldArea = areaIds.map(function (id) { return +document.getElementById(id).value; });

  updateSliderRanges();

  elevIds.forEach(function (id, i) { document.getElementById(id).value = convElev(oldElev[i]); });
  areaIds.forEach(function (id, i) { document.getElementById(id).value = convArea(oldArea[i]); });

  // Update tooltips
  allMarkers.forEach(function (item) {
    item.marker.setTooltipContent(formatTooltip(item.row));
  });

  applyFilters();
}

function applyFilters() {
  var imp = isImperial();

  var e1 = +document.getElementById("elev-min").value;
  var a1 = +document.getElementById("area-min").value;
  var e2 = +document.getElementById("elev-min-2").value;
  var a2 = +document.getElementById("area-min-2").value;

  document.getElementById("elev-val").textContent = e1;
  document.getElementById("area-val").textContent = a1;
  document.getElementById("elev-val-2").textContent = e2;
  document.getElementById("area-val-2").textContent = a2;

  // Convert slider values back to metric for comparison against data
  var eMin1 = imp ? e1 / M_TO_FT : e1;
  var aMin1 = imp ? a1 / HA_TO_ACRES : a1;
  var eMin2 = imp ? e2 / M_TO_FT : e2;
  var aMin2 = imp ? a2 / HA_TO_ACRES : a2;

  var shown = 0;
  allMarkers.forEach(function (item) {
    var area = item.area_hectares == null ? 0 : item.area_hectares;
    var keep = (item.elevation >= eMin1 && area >= aMin1) ||
               (item.elevation >= eMin2 && area >= aMin2);
    if (keep) {
      if (!map.hasLayer(item.marker)) map.addLayer(item.marker);
      shown++;
    } else {
      if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
    }
  });

  document.getElementById("count").textContent = shown;
  updateDataTable();
}

// --- Tab switching ---
var dataTable = null;

document.querySelectorAll('.tab-btn').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    btn.classList.add('active');
    var tabId = btn.getAttribute('data-tab') + '-tab';
    document.getElementById(tabId).classList.add('active');

    if (btn.getAttribute('data-tab') === 'map') {
      map.invalidateSize();
    }

    if (btn.getAttribute('data-tab') === 'data' && dataTable) {
      dataTable.columns.adjust().draw();
    }
  });
});

function rowToTableData(row) {
  var link = '<a href="#" class="map-link" data-lat="' + row.lat + '" data-lon="' + row.lon + '">Show on map</a>';
  return [
    row.name || '',
    row.country || '',
    row.elevation != null ? row.elevation : '',
    row.area_hectares != null ? row.area_hectares : '',
    row.length_m != null ? row.length_m : '',
    row.lat != null ? Number(row.lat).toFixed(5) : '',
    row.lon != null ? Number(row.lon).toFixed(5) : '',
    link
  ];
}

function initDataTable() {
  $('#lochs-table').on('click', '.map-link', function (e) {
    e.preventDefault();
    var lat = parseFloat(this.getAttribute('data-lat'));
    var lon = parseFloat(this.getAttribute('data-lon'));
    // Switch to map tab
    document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
    document.querySelector('.tab-btn[data-tab="map"]').classList.add('active');
    document.getElementById('map-tab').classList.add('active');
    map.invalidateSize();
    map.setView([lat, lon], 7);
  });

  dataTable = $('#lochs-table').DataTable({
    data: [],
    pageLength: 200,
    order: [[2, 'desc']],
    columnDefs: [
      { targets: [2, 3, 4], className: 'dt-right' },
      { targets: 7, orderable: false }
    ]
  });
}

function updateDataTable() {
  if (!dataTable) return;
  var visibleRows = allMarkers.filter(function (item) {
    return map.hasLayer(item.marker);
  }).map(function (item) {
    return rowToTableData(item.row);
  });
  dataTable.clear();
  dataTable.rows.add(visibleRows);
  dataTable.draw();
}

function toggleFilters() {
  var body = document.getElementById('filter-body');
  var btn = document.getElementById('filter-toggle');
  if (body.style.display === 'none') {
    body.style.display = '';
    btn.innerHTML = '&#9650;';
  } else {
    body.style.display = 'none';
    btn.innerHTML = '&#9660;';
  }
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
  a.download = "high_lochs_filtered.csv";
  a.click();
  URL.revokeObjectURL(url);
}
