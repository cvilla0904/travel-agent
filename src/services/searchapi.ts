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
  url.searchParams.set('q', `${params.destino} city center`);
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
    throw new Error(`Error de SearchAPI (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const propiedades = Array.isArray(data.properties) ? data.properties : [];

  // SearchAPI puede devolver el precio como número o como texto y puede
  // devolver alojamientos sin tarifa agregada. No descartamos todo el hotel
  // por ese único campo: la interfaz puede marcar el precio como no disponible.
  const precioNumerico = (...valores: unknown[]): number => {
    for (const valor of valores) {
      if (typeof valor === 'number' && Number.isFinite(valor) && valor > 0) return valor;
      if (typeof valor === 'string' && valor.trim()) {
        const limpio = valor.trim().replace(/[^0-9,.-]/g, '').replace(',', '.');
        const numero = Number(limpio);
        if (Number.isFinite(numero) && numero > 0) return numero;
      }
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

  console.info('[SEARCHAPI_HOTELS_DIAG]', JSON.stringify({
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
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
