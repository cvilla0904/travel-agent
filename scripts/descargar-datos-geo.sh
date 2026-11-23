#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.cache/geo-source"
mkdir -p "$DEST"

echo "Descargando GeoNames cities1000..."
curl -fL --retry 3 "https://download.geonames.org/export/dump/cities1000.zip" -o "$DEST/cities1000.zip"
unzip -oq "$DEST/cities1000.zip" -d "$DEST"

echo "Descargando listado oficial de países GeoNames..."
curl -fL --retry 3 "https://download.geonames.org/export/dump/countryInfo.txt" -o "$DEST/countryInfo.txt"

echo "Descargando aeropuertos de OurAirports desde su repositorio oficial..."
curl -fL --retry 3 "https://davidmegginson.github.io/ourairports-data/airports.csv" -o "$DEST/airports.csv"

echo "Fuentes descargadas en .cache/geo-source"
echo "Siguiente paso: npm run geo:generar"
