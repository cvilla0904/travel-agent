export async function buscarHotelesSearchApi(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
  paisCodigo?: string;
}) {
  const apiKey = process.env.SEARCHAPI_API_KEY;
  if (!apiKey) throw new Error('SEARCHAPI_API_KEY no está configurada.');
  if (!params.destino.trim()) throw new Error('El destino del alojamiento está vacío.');
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(params.fechaEntrada) ||
      !/^\\d{4}-\\d{2}-\\d{2}$/.test(params.fechaSalida)) {
    throw new Error('Las fechas de alojamiento deben tener formato YYYY-MM-DD.');
  }
  if (params.fechaSalida <= params.fechaEntrada) {
    throw new Error('La fecha de salida debe ser posterior a la fecha de entrada.');
  }

  const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
  const normalizar = (valor: unknown) => String(valor ?? '')
    .normalize('NFD')
    .replace(/[\\u0300-\\u036f]/g, '')
    .toLowerCase()
    .trim();

  // Paso 1: resolver el destino en Booking Autocomplete. No usar solo q en la
  // búsqueda final: eso puede devolver otra ciudad con el mismo nombre.
  const autocompleteUrl = new URL('https://www.searchapi.io/api/v1/search');
  autocompleteUrl.searchParams.set('engine', 'booking_autocomplete');
  autocompleteUrl.searchParams.set('q', params.destino);
  autocompleteUrl.searchParams.set('num', '10');
  autocompleteUrl.searchParams.set('language', 'en-us');

  const autocompleteResponse = await fetch(autocompleteUrl, { headers });
  if (!autocompleteResponse.ok) {
    const errorText = await autocompleteResponse.text();
    throw new Error(`Error de SearchAPI autocomplete (${autocompleteResponse.status}): ${errorText.slice(0, 500)}`);
  }

  const autocompleteData: any = await autocompleteResponse.json();
  const suggestions = Array.isArray(autocompleteData.suggestions) ? autocompleteData.suggestions : [];
  const destinoNormalizado = normalizar(params.destino);
  const paisNormalizado = normalizar(params.paisCodigo);

  const candidatos = suggestions.filter((item: any) => {
    if (item?.dest_id == null || !item?.dest_type) return false;
    const title = normalizar(item.title);
    const label = normalizar(item.label);
    const countryCode = normalizar(item.country_code);
    const nombreCoincide =
      title === destinoNormalizado ||
      label === destinoNormalizado ||
      label.startsWith(destinoNormalizado + ',') ||
      // Si el usuario incluye país en la consulta, permitimos el label completo.
      label.includes(destinoNormalizado);
    const paisCoincide = !paisNormalizado || countryCode === paisNormalizado;
    return nombreCoincide && paisCoincide;
  });

  // Elegir coincidencia exacta antes que coincidencia parcial.
  const sugerencia = candidatos.find((item: any) =>
    normalizar(item.title) === destinoNormalizado ||
    normalizar(item.label) === destinoNormalizado ||
    normalizar(item.label).startsWith(destinoNormalizado + ',')
  ) ?? candidatos[0];

  if (!sugerencia) {
    throw new Error(
      `Booking Autocomplete no devolvió un destino verificable para "${params.destino}"` +
      (params.paisCodigo ? ` en el país "${params.paisCodigo}".` : '.')
    );
  }

  console.info('[SEARCHAPI_HOTELS_DIAG] Resolved destination', JSON.stringify({
    query: params.destino,
    destId: sugerencia.dest_id,
    destType: sugerencia.dest_type,
    label: sugerencia.label ?? sugerencia.title,
    countryCode: sugerencia.country_code ?? null,
  }));

  // Paso 2: consultar Booking con dest_id y dest_type resueltos.
  const url = new URL('https://www.searchapi.io/api/v1/search');
  url.searchParams.set('engine', 'booking');
  url.searchParams.set('q', params.destino);
  url.searchParams.set('dest_id', String(sugerencia.dest_id));
  url.searchParams.set('dest_type', String(sugerencia.dest_type));
  url.searchParams.set('check_in_date', params.fechaEntrada);
  url.searchParams.set('check_out_date', params.fechaSalida);
  url.searchParams.set('adults', String(Math.max(1, Math.min(30, Math.floor(params.adultos || 1)))));
  url.searchParams.set('rooms', '1');
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('language', 'en-us');

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Error de SearchAPI Booking (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const data: any = await response.json();
  const destinationCountry = normalizar(data.search_information?.destination?.country_code);
  if (paisNormalizado && destinationCountry && destinationCountry !== paisNormalizado) {
    throw new Error(
      `SearchAPI devolvió el país "${destinationCountry}" en vez de "${paisNormalizado}" para "${params.destino}".`
    );
  }

  const propiedades = Array.isArray(data.properties) ? data.properties : [];
  const precioNumerico = (...valores: unknown[]): number => {
    for (const valor of valores) {
      if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor;
      if (typeof valor !== 'string' || !valor.trim()) continue;
      let limpio = valor.trim().replace(/[^0-9,.-]/g, '');
      if (!limpio) continue;
      if (limpio.includes(',') && limpio.includes('.')) {
        limpio = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
          ? limpio.replace(/\\./g, '').replace(',', '.')
          : limpio.replace(/,/g, '');
      } else if (limpio.includes(',')) {
        const decimales = limpio.length - limpio.lastIndexOf(',') - 1;
        limpio = decimales > 0 && decimales <= 2 ? limpio.replace(',', '.') : limpio.replace(/,/g, '');
      }
      const numero = Number(limpio);
      if (Number.isFinite(numero) && numero > 0) return numero;
    }
    return 0;
  };

  const hoteles = propiedades
    .filter((hotel: any) => typeof hotel?.title === 'string' && hotel.title.trim().length > 0)
    .slice(0, 10)
    .map((hotel: any) => {
      const precioTotal = precioNumerico(hotel.extracted_price, hotel.price, hotel.total_price);
      const precioNoche = precioNumerico(hotel.extracted_nightly_price, hotel.nightly_price);
      return {
        nombre: hotel.title,
        estrellas: Number(hotel.hotel_class ?? 0),
        valoracion: Number(hotel.rating ?? 0),
        numeroResenas: Number(hotel.reviews ?? 0),
        precioTotal,
        precioPorNoche: precioNoche,
        precioDisponible: precioTotal > 0,
        fuentePrecio: precioTotal > 0 ? 'SearchAPI / Booking.com' : '',
        moneda: hotel.currency ?? 'EUR',
        habitacion: hotel.room_type ?? '',
        disponibilidad: hotel.availability ?? '',
        habitacionesDisponibles: Number(hotel.rooms_left ?? 0),
        cancelacionGratuita: hotel.has_free_cancellation ?? false,
        cancelacionHasta: hotel.free_cancellation_until ?? '',
        url: hotel.link ?? '',
        imagen: hotel.thumbnail_hd ?? hotel.thumbnail ?? '',
        zona: hotel.neighborhood ?? '',
        distanciaCentro: hotel.distance ?? '',
      };
    });

  console.info('[SEARCHAPI_HOTELS_DIAG] Search completed', JSON.stringify({
    destination: params.destino,
    destinationCountry,
    checkIn: params.fechaEntrada,
    checkOut: params.fechaSalida,
    propertiesCount: propiedades.length,
    returnedHotels: hoteles.length,
    hotelsWithPrice: hoteles.filter((hotel: any) => hotel.precioDisponible).length,
    responseKeys: Object.keys(data ?? {}),
    propertySampleKeys: propiedades[0] ? Object.keys(propiedades[0]) : [],
  }));

  return {
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    hoteles,
  };
}
