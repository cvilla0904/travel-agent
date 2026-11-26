# Proveedores y variables de entorno por funcionalidad

Solo se documentan **nombres** de variables; nunca valores. Producción no se toca desde esta rama: cualquier variable que falte
en *Preview* debe pedirse/confirmarse antes de cambiarla.

| Funcionalidad | Proveedor principal | Alternativa | Variables |
|---|---|---|---|
| Autocompletado de destinos | Catálogo de destinos versionado (`src/geo/data/catalogo`, ~3.500 ciudades; ver `docs/CATALOGO-DESTINOS.md`), sin llamadas externas | — | — |
| Lugares de interés (herramienta de lugares del agente) | Geoapify | — | `GEOAPIFY_API_KEY` |
| Vuelos | Apify · `johnvc/google-flights-data-scraper-flight-and-price-search` | — | `APIFY_API_TOKEN` (obligatoria), `APIFY_FLIGHTS_BUILD` (opcional, por defecto 0.0.450) |
| Hoteles | Apify · Google Hotels (`eiv/google-hotels-scraper`) | — (sin alternativa ni respaldo en otro proveedor) | `APIFY_API_TOKEN`, `APIFY_HOTELS_WAIT_SECS`, `APIFY_HOTELS_MAX_CHARGE_USD` (tope por búsqueda, máx. 0,25 USD), `APIFY_HOTELS_ITINERARY_BUDGET_USD`, `APIFY_HOTELS_BUILD` |
| Actividades | Apify · `scrapesage/tours-activities-scraper` con **solo Civitatis** (Tiqets eliminado) | — | `APIFY_API_TOKEN`, `APIFY_ACTIVIDADES_WAIT_SECS` (opcional: 45 s por defecto, máx. 120) |
| Agentes (Travel Manager y subagentes) | OpenAI (Agents SDK) | — | `OPENAI_API_KEY` |
| Sesiones y rutas multidestino | Upstash Redis (`Redis.fromEnv()`) | — | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (o los equivalentes `KV_REST_API_*` de la integración) |

## Hoteles
Un único proveedor (Apify). Si falla, el bloque `resultados.hoteles` lleva `estado: error_proveedor` con el motivo (proveedor, fase, HTTP) y no se rellena con datos de otro origen; los demás servicios no se ven afectados.

## Duración de la función (`vercel.json`)
`api/chat.ts` declara `maxDuration: 300`. Presupuesto de espera de los proveedores (se ejecutan en paralelo con el tiempo de los
modelos): vuelos 60 s, hoteles Apify 90 s (`APIFY_HOTELS_WAIT_SECS`), actividades 45 s (`APIFY_ACTIVIDADES_WAIT_SECS`, ≤ 120).
Si el actor de actividades no termina en su presupuesto se devuelve lo ya guardado como **parcial** y se aborta la ejecución.

## Contrato de `/api/chat` (versión 1)
`{ response, resultados: { version: 1, vuelos[], hoteles[], actividades[] }, aviso? }`. Cada bloque:
`tipo, proveedor{id,nombre}, estado (ok|parcial|sin_resultados|error_proveedor|error_parametros|error_interno), error, avisos,
completo, total, consulta, opciones[], diagnostico`. Un dato que el proveedor no da es `null` (nunca 0), cada importe lleva su
moneda (`null` = «Moneda no confirmada»; no hay moneda por defecto ni conversión). La web construye las tarjetas con estos datos;
`response` es solo la explicación del Travel Manager.

`src/services/stayingapi.ts` (`STAYINGAPI_API_KEY`) existe en el repositorio pero **no está conectado** a ninguna herramienta: no es un proveedor activo.
