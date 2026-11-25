# Proveedores y variables de entorno por funcionalidad

Solo se documentan **nombres** de variables; nunca valores. Producción no se toca desde esta rama: cualquier variable que falte
en *Preview* debe pedirse/confirmarse antes de cambiarla.

| Funcionalidad | Proveedor principal | Alternativa | Variables |
|---|---|---|---|
| Autocompletado de destinos | Catálogo local GeoNames v3 (`src/geo/data`, sin llamadas externas) | — | — |
| Lugares de interés (herramienta de lugares del agente) | Geoapify | — | `GEOAPIFY_API_KEY` |
| Vuelos | Apify · `johnvc/google-flights-data-scraper-flight-and-price-search` | — | `APIFY_API_TOKEN` (obligatoria), `APIFY_FLIGHTS_BUILD` (opcional, por defecto 0.0.450) |
| Hoteles | `HOTELES_PROVEEDOR=searchapi` (por defecto): Booking.com vía SearchAPI | `HOTELES_PROVEEDOR=apify`: Google Hotels vía Apify | `HOTELES_PROVEEDOR`; SearchAPI: `SEARCHAPI_API_KEY`; Apify: `APIFY_API_TOKEN`, `APIFY_HOTELS_WAIT_SECS`, `APIFY_HOTELS_MAX_CHARGE_USD` (tope por búsqueda, máx. 0,25 USD), `APIFY_HOTELS_ITINERARY_BUDGET_USD` (presupuesto por itinerario), `APIFY_HOTELS_BUILD` |
| Actividades | Apify · `scrapesage/tours-activities-scraper` con **solo Civitatis** (Tiqets desactivado y sin llamadas) | — | `APIFY_API_TOKEN`, `APIFY_ACTIVIDADES_WAIT_SECS` (opcional: 45 s por defecto, máx. 120) |
| Agentes (Travel Manager y subagentes) | OpenAI (Agents SDK) | — | `OPENAI_API_KEY` |
| Sesiones y rutas multidestino | Upstash Redis (`Redis.fromEnv()`) | — | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (o los equivalentes `KV_REST_API_*` de la integración) |

## Hoteles: ambos proveedores, mismo formato
`HOTELES_PROVEEDOR` solo cambia el origen de los datos. En `/api/chat` los dos entregan el mismo bloque estructurado
(`resultados.hoteles[]`), con importe y moneda ISO por precio. SearchAPI reintenta **una** vez ante HTTP 429 respetando `Retry-After`
(si pide esperar más de 8 s, o el error es de cuota/autenticación, no reintenta); los fallos se registran con proveedor, fase, HTTP y motivo y se muestran como error del proveedor, no como «sin resultados».

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
