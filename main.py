"""Fetch high lochs/lakes from OSM for Scotland, Wales, and England, sample elevation, export CSV."""

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import osm2geojson
import pandas as pd
import rasterio
import requests
from scipy.spatial.distance import pdist

VRT_PATH = Path("scotland_terrain50.vrt")
OUTPUT_CSV = Path("high_lochs.csv")
OSM_CACHE_DIR = Path("osm_cache")

MIN_AREA_M2 = 5_000
MIN_ELEVATION_M = 400
SNAP_GRID_M = 50
MAX_ASPECT_RATIO = 500

EXCLUDED_WATER_TYPES = {
    "reservoir",
    "basin",
    "wastewater",
    "lagoon",
    "river",
    "canal",
    "stream",
    "drain",
    "moat",
    "lock",
    "stream_pool",
}

COUNTRIES = {
    "GB-SCT": "Scotland",
    "GB-WLS": "Wales",
    "GB-ENG": "England",
}

OVERPASS_QUERY_TEMPLATE = """
[out:json][timeout:300];
area["ISO3166-2"="{iso_code}"]->.searchArea;
(
  way["natural"="water"](area.searchArea);
  relation["natural"="water"](area.searchArea);
);
out geom;
"""


def max_diameter(geom):
    """Longest straight line across a polygon, in the geometry's CRS units."""
    if geom is None or geom.is_empty:
        return np.nan
    hull = geom.convex_hull
    if hull.geom_type == "Polygon":
        coords = np.array(hull.exterior.coords)
    else:
        minx, miny, maxx, maxy = geom.bounds
        return np.hypot(maxx - minx, maxy - miny)
    return float(pdist(coords).max())


def compactness(geom):
    """Ratio of polygon area to its oriented bounding box area.
    1.0 = perfectly filled, ~0.1 = long thin river."""
    if geom is None or geom.is_empty:
        return np.nan
    rect = geom.minimum_rotated_rectangle
    if rect.area == 0:
        return np.nan
    return geom.area / rect.area


def aspect_ratio(geom):
    """Length:width ratio of the minimum rotated bounding rectangle."""
    if geom is None or geom.is_empty:
        return np.nan
    rect = geom.minimum_rotated_rectangle
    coords = np.array(rect.exterior.coords)
    sides = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    long, short = sides.max(), sides.min()
    return float(long / short) if short > 0 else np.nan


def fetch_osm_water():
    """Query Overpass API for all water bodies in Scotland, Wales, and England.

    Caches raw OSM JSON responses in osm_cache/ to avoid repeated API calls.
    Delete the cache directory to force a fresh fetch.
    """
    OSM_CACHE_DIR.mkdir(exist_ok=True)
    headers = {
        "User-Agent": "ortom-tarn-finder/0.1 (tom@ortom.ai)",
        "Accept": "application/json",
    }
    parts = []
    for iso_code, country_name in COUNTRIES.items():
        cache_file = OSM_CACHE_DIR / f"{iso_code}.json"

        if cache_file.exists():
            print(f"Loading cached OSM data for {country_name} from {cache_file}")
            data = json.loads(cache_file.read_text())
        else:
            print(f"Fetching water bodies from Overpass API for {country_name}...")
            query = OVERPASS_QUERY_TEMPLATE.format(iso_code=iso_code)
            r = requests.post(
                "https://overpass-api.de/api/interpreter",
                data={"data": query},
                headers=headers,
                timeout=360,
            )
            # if 429 try altenative https://overpass.kumi.systems/api/interpreter
            if r.status_code == 429 or r.status_code == 504:
                print("Rate limited, trying alternative Overpass endpoint...")
                r = requests.post(
                    "https://overpass.private.coffee/api/interpreter",
                    data={"data": query},
                    headers=headers,
                    timeout=360,
                )
            r.raise_for_status()
            data = r.json()
            cache_file.write_text(json.dumps(data))
            print(f"  Saved OSM data to {cache_file}")

        geojson = osm2geojson.json2geojson(data)
        gdf = gpd.GeoDataFrame.from_features(geojson["features"], crs="EPSG:4326")
        gdf["country"] = country_name
        print(f"  {len(gdf)} water bodies for {country_name}")
        parts.append(gdf)

    combined = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs="EPSG:4326")
    print(f"  Total: {len(combined)} water bodies")
    return combined


def clean_and_filter(gdf):
    """Fix geometries, project to BNG, filter by size and type."""
    gdf["geometry"] = gdf.geometry.buffer(0)
    gdf = gdf[gdf.geometry.is_valid & ~gdf.geometry.is_empty].copy()

    gdf = gdf.to_crs("EPSG:27700")
    gdf["area_m2"] = gdf.geometry.area
    gdf = gdf[gdf["area_m2"] >= MIN_AREA_M2].copy()

    gdf["water_type"] = gdf["tags"].apply(lambda t: (t or {}).get("water"))
    gdf["name"] = gdf["tags"].apply(lambda t: (t or {}).get("name"))
    gdf = gdf[~gdf["water_type"].isin(EXCLUDED_WATER_TYPES)].copy()

    print(f"  After size + type filter: {len(gdf)}")
    return gdf


def sample_elevation(gdf, vrt_path):
    """Sample elevation from terrain data at each centroid, filter by altitude."""
    print("Sampling elevation...")
    with rasterio.open(vrt_path) as src:
        centroids = gdf.geometry.centroid
        coords = [(pt.x, pt.y) for pt in centroids]
        elevations = np.array([v[0] for v in src.sample(coords)])

    gdf["elevation_m"] = elevations
    gdf = gdf[gdf["elevation_m"] >= MIN_ELEVATION_M].copy()
    gdf = gdf.sort_values("elevation_m", ascending=False)
    print(f"  After elevation filter (>= {MIN_ELEVATION_M}m): {len(gdf)}")
    return gdf


def deduplicate(gdf, grid_m):
    """Remove near-duplicates by snapping centroids to a grid."""
    gdf["cx"] = (gdf.geometry.centroid.x / grid_m).round() * grid_m
    gdf["cy"] = (gdf.geometry.centroid.y / grid_m).round() * grid_m
    gdf = gdf.drop_duplicates(subset=["cx", "cy"]).copy()
    gdf = gdf.drop(columns=["cx", "cy"])
    print(f"  After deduplication: {len(gdf)}")
    return gdf


def compute_metrics(gdf):
    """Compute shape metrics and filter out river-like shapes."""
    print("Computing shape metrics...")
    gdf["length_m"] = gdf.geometry.apply(max_diameter).round().astype(int)
    gdf["compactness"] = gdf.geometry.apply(compactness).round(3)
    gdf["aspect_ratio"] = gdf.geometry.apply(aspect_ratio).round(2)

    gdf = gdf[gdf["aspect_ratio"] <= MAX_ASPECT_RATIO].copy()
    print(f"  After aspect ratio filter (<= {MAX_ASPECT_RATIO}): {len(gdf)}")
    return gdf


def build_output(gdf):
    """Build the final output DataFrame with coordinates and links."""
    df = gdf.copy()

    df["easting"] = df.geometry.centroid.x.astype(int)
    df["northing"] = df.geometry.centroid.y.astype(int)

    wgs = df.geometry.centroid.to_crs("EPSG:4326")
    df["lat"] = wgs.y.round(5)
    df["lon"] = wgs.x.round(5)

    df["os_map"] = (
        "https://www.streetmap.co.uk/map.srf?X="
        + df["easting"].astype(str)
        + "&Y="
        + df["northing"].astype(str)
        + "&Z=115&A=Y"
    )
    df["google_sat"] = (
        "https://www.google.com/maps/@?api=1&map_action=map&center="
        + df["lat"].astype(str)
        + ","
        + df["lon"].astype(str)
        + "&zoom=15&basemap=satellite"
    )

    out = df[
        [
            "name",
            "country",
            "water_type",
            "area_m2",
            "elevation_m",
            "length_m",
            "lat",
            "lon",
            "os_map",
            "google_sat",
            "compactness",
            "aspect_ratio",
        ]
    ].rename(
        columns={
            "area_m2": "area_sqm",
            "elevation_m": "elevation",
        }
    )

    out["area_sqm"] = out["area_sqm"].round().astype(int)
    out["elevation"] = out["elevation"].round(1)
    out["area_hectares"] = (out["area_sqm"] / 10000).round(2)
    out["name"] = out["name"].fillna("(unnamed)")
    out = out.sort_values("elevation", ascending=False)

    return out


def main():
    gdf = fetch_osm_water()
    gdf = clean_and_filter(gdf)
    gdf = sample_elevation(gdf, VRT_PATH)
    gdf = deduplicate(gdf, SNAP_GRID_M)
    gdf = compute_metrics(gdf)
    out = build_output(gdf)
    out.to_csv(OUTPUT_CSV, index=False)
    print(f"Wrote {len(out)} lochs to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
