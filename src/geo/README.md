# Motor geográfico de Mogavel (`src/geo`)

Fuente única de identidad geográfica para vuelos, hoteles y actividades. **Estado: integrado con `api/geo.ts`, el autocompletado de `index.html` y `src/services/ciudades.ts` (vuelos, actividades, hoteles).** No llama a proveedores.

## Datos
| Archivo | Origen | Se edita a mano |
|---|---|---|
| `data/catalogo/*` (formato v2, ver abajo) | Generado por `scripts/construir-catalogo-geo.ts` desde GeoNames `cities1000` y OurAirports | No |
| `data/regiones.json` | Editorial (regiones turísticas, aeropuertos de acceso, centro aproximado) | Sí |
| `data/destacados.json` | Editorial (ciudades por país, preferencias de nombres repetidos, accesos) | Sí |
| `data/paises-curados.json` | Editorial (nombres de país en español/inglés) | Sí |

`data/catalogo/` **no está en el repositorio** (se genera y está en `.gitignore`). Sin él, `fuenteEnDisco()` lanza
`CatalogoNoDisponible`: nunca devuelve un catálogo vacío como si fuera válido. `/api/geo` responde 503 y el frontend
usa su diccionario local.

Generar: `npm run geo:preparar` (descarga + construcción). Si ya tienes el catálogo antiguo (`data/indice.json`,
`data/paises/*.json`), `npm run geo:reempaquetar` lo convierte al formato v2 sin descargar nada y sin borrar los
archivos antiguos. `npm run geo:medir` mide latencia y memoria (`-- --sintetico` usa datos inventados de 172.000 ciudades, solo para estimar escala).

## Formato v2 (`data/catalogo/`)
El formato antiguo (un `indice.json` de ~32 MB) obligaba a cargarlo entero y recorrer todas sus claves en cada petición.
Ahora:

| Archivo | Contenido | Se lee |
|---|---|---|
| `indice-dir.json` | prefijo de 3 caracteres → posición en `indice.dat` | una vez por proceso |
| `indice.dat` | un bucket gzip por prefijo: `{nombre normalizado → entradas}`; las entradas de ciudad llevan la población | **un bucket por consulta** |
| `fichas.idx` + `fichas.dat` | tabla binaria ordenada por id de GeoNames + ficha ligera de cada ciudad | búsqueda binaria + una lectura por ficha |
| `aeropuertos.json` | todos los aeropuertos comerciales por IATA (~3.000) | una vez, bajo demanda |
| `paises.json`, `paises/XX.json.gz` | países; ciudades y aeropuertos de un país (con nombres alternativos) | solo para selección de ciudades por país y acceso aéreo |
| `meta.json` | formato, fecha, recuentos y SHA-256 de cada archivo | arranque |

El prefijo cuenta puntos de código Unicode (no unidades UTF-16), así que funciona igual con cirílico, kanji, etc.
Las claves son las de `normalizar()` (sin acentos, minúsculas). `verificarIntegridad(dir)` comprueba los SHA-256.
El autocompletado ordena por coincidencia exacta, tipo (ciudad > país > región > aeropuerto), población y nombre,
y solo consulta las fichas de los resultados que va a mostrar.

## Criterios (mantenimiento)
- **Aeropuerto comercial:** OurAirports `large_airport` o `medium_airport`, `scheduled_service = yes`, IATA de 3 letras.
- **Aeropuerto → ciudad:** una sola ciudad del mismo país a ≤ 80 km, la que maximiza `población / (1 + d/15 km)²`. Sin ciudad cercana no se asocia (el script lista los aeropuertos sin ciudad para revisarlos).
- **Ciudades sin aeropuerto (p. ej. Kioto):** `accesoAereoDeCiudad` propone los del mismo país a ≤ 200 km (máx. 3) con nombre y distancia en línea recta, o los de `destacados.acceso` si existen. El destino nunca se cambia en silencio.
- **Cinco ciudades por país:** 1) las de `destacados.paises[ISO].ciudades` con aeropuerto comercial propio, en ese orden; 2) el resto por puntuación `0,45·tipo + 0,35·población(log) + 0,20·nº aeropuertos`. Las ciudades a ≤ 50 km cuentan como una. **El catálogo no tiene rutas ni tráfico:** la conectividad real se ve al buscar vuelos (estado por ciudad).
- **Ambigüedad:** si varias entidades distintas casan con el nombre, se devuelve `aclaracion`. Solo `destacados.preferidos` (nombre normalizado → ISO) resuelve sin preguntar. Se resuelve igualmente si se indica el país («Valencia, España»).
- **Estados:** ver `estados.ts` (reconocimiento, proveedor y descartes por ubicación se mantienen separados).
- **Respaldo:** `respaldo-geoapify.ts` solo se usa si el catálogo no reconoce el destino; un fallo del servicio es `error_geocodificador`, no `no_encontrado`.

## Licencias
GeoNames: CC BY 4.0 (atribución obligatoria; Mogavel debe mostrar atribución a GeoNames). OurAirports: dominio público. Geoapify: servicio de terceros; revisar sus condiciones antes de cachear respuestas.

## API propia de Mogavel

- Endpoint: `GET /api/geo?q=mad`.
- Parámetros: `q` (3–100 caracteres, tras normalizar), `pais` (ISO-2 opcional) y `limite` (1–12, por defecto 8).
- Devuelve países, ciudades, regiones y aeropuertos por nombre exacto o prefijo, con país, coordenadas y códigos IATA cuando existen.
- No llama a Geoapify, SearchAPI ni Apify: consulta localmente el catálogo generado (un bucket por petición).
- Si el catálogo no existe, responde HTTP 503 con `CATALOGO_NO_GENERADO`; no finge que no hay destinos.
- `vercel.json` incluye `src/geo/data/{catalogo/**,regiones.json,destacados.json}` en `api/geo.ts` y `api/chat.ts`. **El catálogo no está en Git, así que un despliegue desde Git no lo tendrá** hasta decidir cómo llegar a Vercel (ver «Despliegue» más abajo). Mientras tanto la API responde 503 y el frontend usa su respaldo. Añadir en la web una atribución visible a GeoNames antes de producción, conforme a CC BY 4.0.

## Alcance y límites conocidos

- `cities1000` amplía la cobertura frente a `cities15000`, pero no contiene todos los pueblos ni todos los puntos turísticos. Los destinos pequeños importantes deben añadirse editorialmente o mediante una fuente adicional revisada.
- Se conservan nombres alternativos de GeoNames y se complementan nombres localizados de países mediante `Intl.DisplayNames`. `alternateNamesV2` no se descarga por defecto.
- La asociación de aeropuertos usa proximidad y población; no demuestra que existan vuelos directos ni que sea el mejor acceso terrestre.
- La generación escribe en `src/geo/data`. No subir los archivos originales ni `.cache/geo-source`.

## Despliegue del catálogo (decisión pendiente)
`data/catalogo/` ocupa (con datos reales) del orden de decenas de MB y es un artefacto generado. Opciones:
1. **Commit del catálogo v2** (sin el índice antiguo): simple y reproducible, pero cada regeneración añade MB al historial. Los archivos individuales son < 15 MB (por debajo del límite de GitHub).
2. **Generarlo en el build**: exige que Vercel ejecute `npm run geo:preparar` (descarga ~20 MB de GeoNames/OurAirports en cada build) y pasar a un `buildCommand`; hoy `vercel.json` usa `builds`, que lo ignora.
3. **Almacenamiento externo** (Vercel Blob / R2) con lectura por rangos: escala mejor, pero añade infraestructura.
No se ha hecho commit de datos generados; la elección y el impacto de tamaño deben validarse con las cifras reales (`npm run geo:medir`).
