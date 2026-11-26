# Catálogo de destinos de Mogavel

Fuente única de destinos para el autocompletado (`/api/geo`), el backend, los agentes y los aeropuertos de vuelos. Es un catálogo
**práctico** (~3.500 ciudades, ~3.000 aeropuertos, ~5 MB), no un catálogo mundial.

## Qué contiene y qué no mezcla
- **Ciudad**, **aeropuerto**, **código IATA de aeropuerto**, **código IATA de ciudad** (PAR, LON, ROM…), **país**, **región** y **coordenadas** son campos distintos.
- Cada ciudad tiene como máximo 3 aeropuertos; el primero es el principal (`aeropuertosPrincipales`). Los secundarios solo se conservan si son grandes o editoriales.
- A los proveedores de vuelos solo llegan códigos de **aeropuerto**: un código de ciudad se traduce al aeropuerto principal (PAR → CDG) y se avisa.
- Homónimos (Salento, Cartagena, Valencia…) se distinguen por país y región; los destinos editoriales (`ed:`) cubren islas y zonas (Menorca, Santorini, Dolomitas…).
- Geoapify no añade lugares al catálogo ni se llama por pulsación de tecla.

## Cómo se selecciona (`scripts/seleccionar-catalogo-geo.ts`)
Entran: ciudades con aeropuerto, con ≥ 500.000 habitantes, la mayor de cada país, las imprescindibles, las curadas y homónimos
editoriales. Las localidades menores con el mismo nombre que un destino editorial se descartan (manda el editorial). Los criterios editoriales están en
`src/geo/data/seleccion-destinos.json`. Regenerar: `node scripts/seleccionar-catalogo-geo.ts <catalogo-completo-v3> src/geo/data/catalogo`.

## Límites conocidos
- Los códigos IATA de ciudad y las listas de aeropuertos principales son los habituales del sector, **pero NO se han contrastado con el directorio oficial de IATA**: pendiente de verificación externa.
- Las cifras de la selección dependen del catálogo completo GeoNames/OurAirports usado como origen.
- Atribución CC BY 4.0 (GeoNames) y OurAirports pendiente de mostrar en la web.
