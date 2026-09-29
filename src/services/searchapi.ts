export async function buscarHotelesSearchApi(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
}) {
  const apiKey = process.env.SEARCHAPI_API_KEY;

  if (!apiKey) {
    throw new Error('SEARCHAPI_API_KEY no está configurada.');
  }

  const url = new URL('https://www.searchapi.io/api/v1/search');

  url.searchParams.set('engine', 'booking');

  // Buscamos explícitamente en la ciudad,
  // evitando que Booking priorice aeropuertos o zonas periféricas.
  url.searchParams.set(
    'q',
    `${params.destino} city center`,
  );

  url.searchParams.set(
    'check_in_date',
    params.fechaEntrada,
  );

  url.searchParams.set(
    'check_out_date',
    params.fechaSalida,
  );

  url.searchParams.set(
    'adults',
    String(params.adultos),
  );

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