# Motor geográfico de Mogavel (`src/geo`)

Fuente única de identidad geográfica para vuelos, hoteles y actividades. **Estado: núcleo local (sin proveedores).**
Todavía no está conectado a `buscar_vuelos`, `buscar_hoteles` ni `buscar_actividades`.

## Datos
| Archivo | Origen | Se edita a mano |
|---|---|---|
| `data/indice.json`, `data/paises.json`, `data/paises/<ISO>.json` | Generados por `scripts/construir-catalogo-geo.ts` desde GeoNames `cities1000` y OurAirports | No |
| `data/regiones.json` | Editorial (regiones turísticas, aeropuertos de acceso, centro aproximado) | Sí |
| `data/destacados.json` | Editorial (ciudades por país, preferencias de nombres repetidos, accesos) | Sí |
| `data/paises-curados.json` | Editorial (nombres de país en español/inglés) | Sí |

`indice.json` y `paises/` **no están en el repositorio hasta que se genere el catálogo real** (requiere descargar GeoNames y OurAirports).
Sin ellos, `fuenteEnDisco()` lanza `CatalogoNoDisponible`: nunca devuelve un catálogo vacío como si fuera válido.

Generar: `npm run geo:preparar` (o ejecutar `geo:descargar` y `geo:generar` por separado). El descargador usa GeoNames cities1000, countryInfo y OurAirports; no requiere cuenta ni clave. `alternateNamesV2.txt` es opcional y no se descarga por defecto por su tamaño.

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
- Parámetros: `q` (2–100 caracteres), `pais` (ISO-2 opcional) y `limite` (1–12, por defecto 8).
- Devuelve países, ciudades, regiones y aeropuertos por nombre exacto o prefijo, con país, coordenadas y códigos IATA cuando existen.
- No llama a Geoapify, SearchAPI ni Apify: consulta localmente el catálogo generado.
- Si el catálogo no existe, responde HTTP 503 con `CATALOGO_NO_GENERADO`; no finge que no hay destinos.
- Vercel incluye `src/geo/data/**` en la función. El catálogo debe generarse antes de considerar operativo el endpoint. Añadir en la web una atribución visible a GeoNames antes de producción, conforme a CC BY 4.0.

## Alcance y límites conocidos

- `cities1000` amplía la cobertura frente a `cities15000`, pero no contiene todos los pueblos ni todos los puntos turísticos. Los destinos pequeños importantes deben añadirse editorialmente o mediante una fuente adicional revisada.
- Se conservan nombres alternativos de GeoNames y se complementan nombres localizados de países mediante `Intl.DisplayNames`. `alternateNamesV2` no se descarga por defecto.
- La asociación de aeropuertos usa proximidad y población; no demuestra que existan vuelos directos ni que sea el mejor acceso terrestre.
- La generación escribe en `src/geo/data`. No subir los archivos originales ni `.cache/geo-source`.
