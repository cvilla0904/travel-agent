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
      prices?: Array<{
        source?: string;
        link?: string;
        official?: boolean;
        num_guests?: number | string;
        rate_per_night?: { extracted_lowest?: number; lowest?: string };
        total_rate?: { extracted_lowest?: number; lowest?: string };
        free_cancellation?: boolean;
        free_cancellation_until_date?: string;
      }>;
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
        Number((hotel.hotel_class ?? '').match(/\\d+/)?.[0] ?? 0);

      // Compare only provider offers with a real total for these dates and
      // guests. Do not invent a stay total by multiplying a nightly price.
      const ofertas = (hotel.prices ?? [])
        .filter((price) =>
          typeof price.source === 'string' &&
          price.source.trim().length > 0 &&
          typeof price.link === 'string' &&
          /^https?:\\/\\//i.test(price.link) &&
          typeof price.total_rate?.extracted_lowest === 'number' &&
          Number.isFinite(price.total_rate.extracted_lowest) &&
          price.total_rate.extracted_lowest > 0
        )
        .map((price) => ({
          proveedor: price.source!.trim(),
          precioTotal: Number(price.total_rate!.extracted_lowest),
          precioPorNoche: typeof price.rate_per_night?.extracted_lowest === 'number' &&
            Number.isFinite(price.rate_per_night.extracted_lowest) &&
            price.rate_per_night.extracted_lowest > 0
              ? Number(price.rate_per_night.extracted_lowest)
              : Number((Number(price.total_rate!.extracted_lowest) / nights).toFixed(2)),
          url: price.link!,
          esWebOficial: price.official === true,
          cancelacionGratuita: price.free_cancellation === true,
          cancelacionHasta: price.free_cancellation_until_date ?? '',
        }))
        .sort((a, b) => a.precioTotal - b.precioTotal)
        .slice(0, 5);

      // The selected price and booking URL always come from the same offer.
      // If no provider total is available, use Google's aggregate price and
      // its comparison page rather than pairing it with an unrelated URL.
      const mejorOferta = ofertas[0];
      const precioMostrado = mejorOferta?.precioTotal ?? priceTotal;
      const precioPorNocheMostrado = mejorOferta?.precioPorNoche ??
        (typeof nightly === 'number' && nightly > 0
          ? nightly
          : Number((priceTotal / nights).toFixed(2)));
      const urlMostrada = mejorOferta?.url ??
        hotel.serpapi_property_details_link ??
        hotel.link ??
        hotel.prices?.find((price) => price.link)?.link ?? '';

      return {
        nombre: hotel.name ?? '',
        estrellas: Number.isFinite(stars) ? stars : 0,
        valoracion: Number(hotel.overall_rating ?? 0),
        numeroResenas: Number(hotel.reviews ?? 0),
        // 0 is a sentinel for "price not provided", never a free stay.
        precioTotal: hasUsablePrice ? precioMostrado : 0,
        precioPorNoche: hasUsablePrice ? precioPorNocheMostrado : 0,
        precioDisponible: hasUsablePrice,
        moneda: 'EUR',
        habitacion: '',
        disponibilidad: 'Precio mostrado por Google Hotels; confirmar en el proveedor',
        habitacionesDisponibles: 0,
        cancelacionGratuita: false,
        cancelacionHasta: '',
        url: urlMostrada,
        ofertas,
        imagen: hotel.images?.[0]?.original_image ?? hotel.images?.[0]?.thumbnail ?? '',
        zona: (hotel.nearby_places ?? []).map((place) => place.name).filter(Boolean).slice(0, 2).join(', '),
        distanciaCentro: '',
        // Keep the displayed provider consistent with the selected offer.
        fuentePrecio: mejorOferta?.proveedor ?? 'Google Hotels',
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
