export async function buscarHotelesSearchApi(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
  paisCodigo?: string;
}) {
  const apiKey = process.env.SEARCHAPI_API_KEY;

  if (!apiKey) {
    throw new Error('SEARCHAPI_API_KEY no está configurada.');
  }

  const autocompleteUrl = new URL('https://www.searchapi.io/api/v1/search');
  autocompleteUrl.searchParams.set('engine', 'booking_autocomplete');
  autocompleteUrl.searchParams.set('q', params.destino);
  autocompleteUrl.searchParams.set('num', '10');
  autocompleteUrl.searchParams.set('language', 'en-us');

  const autocompleteResponse = await fetch(autocompleteUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!autocompleteResponse.ok) {
    const errorText = await autocompleteResponse.text();
    throw new Error(
      `Error de SearchAPI autocomplete (${autocompleteResponse.status}): ${errorText}`,
    );
  }

  const autocompleteData = await autocompleteResponse.json();
  const suggestions = Array.isArray(autocompleteData.suggestions)
    ? autocompleteData.suggestions
    : [];

  const normalizar = (valor: string) =>
    String(valor ?? '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .trim();

  const destinoNormalizado = normalizar(params.destino);
  const sugerencia = suggestions.find((item: any) => {
    const title = normalizar(item.title);
    const label = normalizar(item.label);
    const countryCode = normalizar(item.country_code);

    const nombreCoincide =
      title === destinoNormalizado ||
      label.startsWith(destinoNormalizado + ',') ||
      label.includes(destinoNormalizado);

    const paisCoincide =
      !params.paisCodigo || countryCode === normalizar(params.paisCodigo);

    return item.dest_id && item.dest_type && nombreCoincide && paisCoincide;
  });

  if (!sugerencia) {
    throw new Error(
      `No se ha podido verificar "${params.destino}" en Booking.com para el país solicitado.`,
    );
  }

  const url = new URL('https://www.searchapi.io/api/v1/search');
  url.searchParams.set('engine', 'booking');
  url.searchParams.set('q', params.destino);
  url.searchParams.set('dest_id', String(sugerencia.dest_id));
  url.searchParams.set('dest_type', String(sugerencia.dest_type));
  url.searchParams.set('check_in_date', params.fechaEntrada);
  url.searchParams.set('check_out_date', params.fechaSalida);
  url.searchParams.set('adults', String(params.adultos));
  url.searchParams.set('rooms', '1');
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('language', 'en-us');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Error de SearchAPI (${response.status}): ${errorText}`,
    );
  }

  const data = await response.json();

  const destinationCountry =
    normalizar(data.search_information?.destination?.country_code);

  if (params.paisCodigo && destinationCountry !== normalizar(params.paisCodigo)) {
    throw new Error(
      `SearchAPI devolvió un destino de país incorrecto (${destinationCountry || 'desconocido'}) para "${params.destino}".`,
    );
  }

  const propiedades = Array.isArray(data.properties)
    ? data.properties
    : [];

  const hoteles = propiedades
    .filter(
      (hotel: any) =>
        hotel.title &&
        typeof hotel.extracted_price === 'number',
    )
    .slice(0, 10)
    .map((hotel: any) => ({
      nombre: hotel.title,
      estrellas: Number(hotel.hotel_class ?? 0),
      valoracion: Number(hotel.rating ?? 0),
      numeroResenas: Number(hotel.reviews ?? 0),
      precioTotal: Number(hotel.extracted_price ?? 0),
      precioPorNoche: Number(
        hotel.extracted_nightly_price ?? 0,
      ),
      moneda: hotel.currency ?? 'EUR',
      habitacion: hotel.room_type ?? '',
      disponibilidad: hotel.availability ?? '',
      habitacionesDisponibles: Number(
        hotel.rooms_left ?? 0,
      ),
      cancelacionGratuita:
        hotel.has_free_cancellation ?? false,
      cancelacionHasta:
        hotel.free_cancellation_until ?? '',
      url: hotel.link ?? '',
      imagen:
        hotel.thumbnail_hd ??
        hotel.thumbnail ??
        '',
      zona: hotel.neighborhood ?? '',
      distanciaCentro: hotel.distance ?? '',
    }));

  return {
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    hoteles,
  };
}
