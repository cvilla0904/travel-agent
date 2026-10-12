/**
 * Hotel search through SerpApi's Google Hotels engine.
 * Uses the same SERPAPI_API_KEY already configured for flight search.
 * Prices are comparison prices returned by Google Hotels; no artificial
 * markup is applied and the provider's booking links are preserved when present.
 */
export async function buscarHotelesSerpApi(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
}) {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error('SERPAPI_API_KEY no está configurada para la búsqueda de hoteles.');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaEntrada) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaSalida) ||
      params.fechaSalida <= params.fechaEntrada) {
    throw new Error('Las fechas de alojamiento no son válidas.');
  }
  if (!Number.isInteger(params.adultos) || params.adultos < 1 || params.adultos > 9) {
    throw new Error('El número de adultos debe estar entre 1 y 9.');
  }

  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('engine', 'google_hotels');
  url.searchParams.set('q', params.destino);
  url.searchParams.set('check_in_date', params.fechaEntrada);
  url.searchParams.set('check_out_date', params.fechaSalida);
  url.searchParams.set('adults', String(params.adultos));
  url.searchParams.set('children', '0');
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('gl', 'es');
  url.searchParams.set('hl', 'es');
  url.searchParams.set('api_key', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Error de SerpApi Google Hotels (HTTP ${response.status}).`);
  }

  const data = await response.json() as {
    error?: string;
    search_metadata?: { status?: string };
    search_information?: { total_results?: number };
    properties?: Array<{
      type?: string;
      name?: string;
      link?: string;
      description?: string;
      hotel_class?: string;
      extracted_hotel_class?: number;
      overall_rating?: number;
      reviews?: number;
      rate_per_night?: { extracted_lowest?: number; lowest?: string };
      total_rate?: { extracted_lowest?: number; lowest?: string };
      prices?: Array<{ source?: string; link?: string }>;
      images?: Array<{ thumbnail?: string; original_image?: string }>;
      nearby_places?: Array<{ name?: string }>;
      property_token?: string;
      serpapi_property_details_link?: string;
      amenities?: string[];
    }>;
  };

  if (data.error) {
    throw new Error(`SerpApi Google Hotels: ${data.error}`);
  }

  const nights = Math.max(1, (Date.parse(`${params.fechaSalida}T00:00:00Z`) -
    Date.parse(`${params.fechaEntrada}T00:00:00Z`)) / 86400000);

  // Google Hotels can return real properties without a price for the
  // selected dates. Keep those properties visible instead of turning a
  // partial-price response into a misleading "no hotels found" result.
  const hoteles = (data.properties ?? [])
    .filter((hotel) => Boolean(hotel.name))
    .slice(0, 10)
    .map((hotel) => {
      const total = hotel.total_rate?.extracted_lowest;
      const nightly = hotel.rate_per_night?.extracted_lowest;
      const priceTotal = typeof total === 'number' && total > 0
        ? total
        : typeof nightly === 'number' && nightly > 0
          ? Number((nightly * nights).toFixed(2))
          : 0;
      const hasUsablePrice = (typeof total === 'number' && Number.isFinite(total) && total > 0) ||
        (typeof nightly === 'number' && Number.isFinite(nightly) && nightly > 0);
      const stars = hotel.extracted_hotel_class ??
        Number((hotel.hotel_class ?? '').match(/\d+/)?.[0] ?? 0);
      const propertyLink = hotel.link ??
        hotel.prices?.find((price) => price.link)?.link ??
        hotel.serpapi_property_details_link ?? '';

      return {
        nombre: hotel.name ?? '',
        estrellas: Number.isFinite(stars) ? stars : 0,
        valoracion: Number(hotel.overall_rating ?? 0),
        numeroResenas: Number(hotel.reviews ?? 0),
        // 0 is a sentinel for "price not provided", never a free stay.
        precioTotal: hasUsablePrice ? priceTotal : 0,
        precioPorNoche: hasUsablePrice
          ? (typeof nightly === 'number' && nightly > 0
              ? nightly
              : Number((priceTotal / nights).toFixed(2)))
          : 0,
        precioDisponible: hasUsablePrice,
        moneda: 'EUR',
        habitacion: '',
        disponibilidad: 'Precio mostrado por Google Hotels; confirmar en el proveedor',
        habitacionesDisponibles: 0,
        cancelacionGratuita: false,
        cancelacionHasta: '',
        url: propertyLink,
        imagen: hotel.images?.[0]?.original_image ?? hotel.images?.[0]?.thumbnail ?? '',
        zona: (hotel.nearby_places ?? []).map((place) => place.name).filter(Boolean).slice(0, 2).join(', '),
        distanciaCentro: '',
        fuentePrecio: hotel.prices?.[0]?.source ?? 'Google Hotels',
        descripcion: hotel.description ?? '',
        tipo: hotel.type ?? 'hotel',
      };
    });

  return {
    proveedor: 'SerpApi Google Hotels',
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    totalResultados: Number(data.search_information?.total_results ?? hoteles.length),
    hoteles,
  };
}
