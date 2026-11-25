/**
 * Instrucciones adicionales para los agentes cuando HOTELES_PROVEEDOR=apify.
 * Se AÑADEN al final de las instrucciones existentes (que siguen intactas para SearchAPI)
 * y prevalecen sobre ellas en lo relativo a Booking.com/SearchAPI, la escala de valoración
 * y la presentación de precios.
 */
/** Descripción de la herramienta buscar_hoteles cuando el proveedor es Apify (vive aquí, no en index.ts). */
export const DESCRIPCION_HERRAMIENTA_HOTELES_APIFY =
  'Busca alojamientos en Google Hotels (con ofertas de varios proveedores de reserva) con destino, fechas y número de adultos. Conserva los alojamientos reales aunque no haya una oferta con precio verificable y marca el precio como no disponible.';

export const INSTRUCCIONES_HOTELES_APIFY_AGENTE = `

    PROVEEDOR ACTIVO: "Apify / Google Hotels" (campo "proveedor"). Para este proveedor, lo dicho antes sobre Booking.com, SearchAPI y la escala de 10 puntos NO se aplica. Sí se aplican las reglas de "estado" y de errores.
    - tipoAlojamiento indica si es hotel, hostal, resort, apartamento vacacional, etc. Respétalo: no llames "hotel" a un hostal o a un apartamento.
    - estrellas, valoracion, valoracionEscala y numeroResenas son null cuando no hay dato. Déjalos null (o "Sin valoración"); NUNCA los conviertas en 0 ni los inventes. Si hay valoración, usa valoracionEscala tal cual.
    - precioTotal es el total de la estancia y precioPorNoche es precioTotal dividido entre las noches (derivado). Si impuestosIncluidos es true, el total incluye impuestos. Si es false, el total es SIN impuestos y pueden añadirse al reservar. No sumes, restes ni estimes impuestos.
    - El precio mostrado y el enlace url pertenecen a la MISMA oferta (fuentePrecio). No mezcles el precio de una oferta con el enlace de otra.
    - "ofertas" es la lista de ofertas válidas (la primera es la que da el precio principal). Cada una trae su precio SIN impuestos y su enlace. Si "ofertaIndividual" es true, hay UNA sola oferta: preséntala como oferta individual, sin decir que se ha comparado ni que es la más barata.
    - Son precios publicados por cada proveedor en el momento de la búsqueda y pueden variar. Rotula los enlaces como "Ver oferta en <proveedor>", nunca como "reservar ya". Algunos enlaces llevan a una lista de resultados y no a la ficha del alojamiento.
    - Si precioDisponible es false no hay oferta con precio verificable: escribe "Precio no disponible". Puedes ofrecer urlGoogleHoteles (si existe) como "Ver en Google Hoteles", sin precio.
    - NO muestres imágenes ni URLs de imágenes.
`;

export const INSTRUCCIONES_HOTELES_APIFY_MANAGER = `

    PROVEEDOR DE ALOJAMIENTO "Apify / Google Hotels" (campo "proveedor" de hotel_agent y de buscar_recursos_multidestino). Con este proveedor, lo dicho antes sobre la escala de 10 puntos de Booking.com y sobre enlazar solo con url NO se aplica así:
    - Si valoracion es null, no escribas valoración ni "0": escribe "Sin valoración" o nada. Con valoración, usa valoracionEscala (normalmente 5).
    - Indica el tipoAlojamiento (hotel, hostal, resort, apartamento vacacional...).
    - Muestra el total con su estado de impuestos: impuestosIncluidos true → "impuestos incluidos"; false → "sin impuestos". Y el precio por noche (precioPorNoche).
    - Pon el precio junto al proveedor y enlace de la MISMA oferta: "[Ver oferta en <fuentePrecio>](url)". Si hay varias ofertas, puedes añadir las siguientes de "ofertas" con su propio enlace, cada una con su propio precio (sin impuestos). Si ofertaIndividual es true, preséntala como oferta individual, sin comparación ni "mejor precio".
    - No digas que un alojamiento es el más barato ni garantices el precio: son precios publicados en el momento de la búsqueda.
    - No muestres imágenes.
    - La web pinta las tarjetas de alojamiento directamente con los datos de la herramienta (precio por noche y total con su moneda ISO, valoración con su escala, oferta y enlace de la misma fuente). NO repitas la lista de alojamientos en tu texto: escribe solo la explicación.
    - No fijes monedas: usa la moneda del campo "moneda" de cada importe. Sin precio: "Precio no disponible". Sin moneda: "Moneda no confirmada".
`;
