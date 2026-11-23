# Motor geográfico de Mogavel (`src/geo`)

Fuente única de identidad geográfica para vuelos, hoteles y actividades. **Estado: núcleo local (sin proveedores).**
Todavía no está conectado a `buscar_vuelos`, `buscar_hoteles` ni `buscar_actividades`.

## Datos
| Archivo | Origen | Se edita a mano |
|---|---|---|
| `data/indice.json`, `data/paises.json`, `data/paises/<ISO>.json` | Generados por `scripts/construir-catalogo-geo.ts` desde GeoNames `cities15000` y OurAirports | No |
| `data/regiones.json` | Editorial (regiones turísticas, aeropuertos de acceso, centro aproximado) | Sí |
| `data/destacados.json` | Editorial (ciudades por país, preferencias de nombres repetidos, accesos) | Sí |
| `data/paises-curados.json` | Editorial (nombres de país en español/inglés) | Sí |

`indice.json` y `paises/` **no están en el repositorio hasta que se genere el catálogo real** (requiere descargar GeoNames y OurAirports).
Sin ellos, `fuenteEnDisco()` lanza `CatalogoNoDisponible`: nunca devuelve un catálogo vacío como si fuera válido.

Generar: `npx tsx scripts/construir-catalogo-geo.ts <carpeta con cities15000.txt, countryInfo.txt, airports.csv [, alternateNamesV2.txt]>`.

## Criterios (mantenimiento)
- **Aeropuerto comercial:** OurAirports `large_airport` o `medium_airport`, `scheduled_service = yes`, IATA de 3 letras.
- **Aeropuerto → ciudad:** una sola ciudad del mismo país a ≤ 80 km, la que maximiza `población / (1 + d/15 km)²`. Sin ciudad cercana no se asocia (el script lista los aeropuertos sin ciudad para revisarlos).
- **Ciudades sin aeropuerto (p. ej. Kioto):** `accesoAereoDeCiudad` propone los del mismo país a ≤ 200 km (máx. 3) con nombre y distancia en línea recta, o los de `destacados.acceso` si existen. El destino nunca se cambia en silencio.
- **Cinco ciudades por país:** 1) las de `destacados.paises[ISO].ciudades` con aeropuerto comercial propio, en ese orden; 2) el resto por puntuación `0,45·tipo + 0,35·población(log) + 0,20·nº aeropuertos`. Las ciudades a ≤ 50 km cuentan como una. **El catálogo no tiene rutas ni tráfico:** la conectividad real se ve al buscar vuelos (estado por ciudad).
- **Ambigüedad:** si varias entidades distintas casan con el nombre, se devuelve `aclaracion`. Solo `destacados.preferidos` (nombre normalizado → ISO) resuelve sin preguntar. Se resuelve igualmente si se indica el país («Valencia, España»).
- **Estados:** ver `estados.ts` (reconocimiento, proveedor y descartes por ubicación se mantienen separados).
- **Respaldo:** `respaldo-geoapify.ts` solo se usa si el catálogo no reconoce el destino; un fallo del servicio es `error_geocodificador`, no `no_encontrado`.

## Licencias
GeoNames: CC BY 4.0 (atribución obligatoria). OurAirports: dominio público. Geoapify: servicio de terceros; revisar sus condiciones antes de cachear respuestas.
