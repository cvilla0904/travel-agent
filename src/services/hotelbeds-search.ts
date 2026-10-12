import { createHash } from 'node:crypto';
import https from 'node:https';

type HotelbedsRate = {
  net?: string | number;
  sellingRate?: string | number;
  hotelSellingRate?: string | number;
  hotelMandatory?: boolean | null;
  rateType?: string;
  hotelCurrency?: string;
  allotment?: number;
  boardName?: string;
  cancellationPolicies?: Array<{ amount?: string | number; from?: string }>;
};

type HotelbedsHotel = {
  code?: number | string;
  name?: string;
  categoryCode?: string;
  categoryName?: string;
  zoneName?: string;
  currency?: string;
  rooms?: Array<{
    name?: string;
    rates?: HotelbedsRate[];
  }>;
};

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function hotelbedsRequest<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const apiKey = requiredEnv('HOTELBEDS_API_KEY');
  const secret = requiredEnv('HOTELBEDS_API_SECRET');
  const cert = requiredEnv('HOTELBEDS_CLIENT_CERT');
  const key = requiredEnv('HOTELBEDS_CLIENT_KEY');
  const passphrase = requiredEnv('HOTELBEDS_CLIENT_KEY_PASSPHRASE');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash('sha256')
    .update(`${apiKey}${secret}${timestamp}`)
    .digest('hex');
  const payload = body === undefined ? undefined : JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api-mtls.test.hotelbeds.com',
        path,
        method,
        cert,
        key,
        passphrase,
        headers: {
          Accept: 'application/json',
          'Api-key': apiKey,
          'X-Signature': signature,
          ...(payload ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          } : {}),
        },
        timeout: 20000,
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { responseBody += chunk; });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            // Avoid forwarding provider response bodies to the user or logs.
            reject(new Error(`Hotelbeds devolvió HTTP ${status} en ${path}.`));
            return;
          }

          try {
            resolve(JSON.parse(responseBody) as T);
          } catch {
            reject(new Error('Hotelbeds devolvió una respuesta que no es JSON válido.'));
          }
        });
      },
    );

    request.on('timeout', () => request.destroy(new Error('Tiempo de espera agotado al conectar con Hotelbeds.')));
    request.on('error', (error) => reject(new Error(`Error de conexión mTLS con Hotelbeds: ${error.message}`)));
    if (payload) request.write(payload);
    request.end();
  });
}

async function geocodificarDestino(destino: string): Promise<{ latitude: number; longitude: number }> {
  const apiKey = requiredEnv('GEOAPIFY_API_KEY');
  const url = new URL('https://api.geoapify.com/v1/geocode/search');
  url.searchParams.set('text', destino);
  url.searchParams.set('type', 'city');
  url.searchParams.set('limit', '1');
  url.searchParams.set('apiKey', apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geoapify no pudo localizar el destino (HTTP ${response.status}).`);
  }

  const data = await response.json() as {
    features?: Array<{ properties?: { lat?: number; lon?: number; city?: string; name?: string } }>;
  };
  const properties = data.features?.[0]?.properties;
  if (
    typeof properties?.lat !== 'number' ||
    typeof properties?.lon !== 'number'
  ) {
    throw new Error(`No se han podido obtener las coordenadas del destino "${destino}".`);
  }

  return { latitude: properties.lat, longitude: properties.lon };
}

/**
 * Real Hotelbeds availability search in the TEST environment.
 * Uses Geoapify only to resolve the city coordinates; prices and availability
 * come from Hotelbeds Booking API.
 */
export async function buscarHotelesHotelbeds(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(params.fechaEntrada) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(params.fechaSalida)) {
    throw new Error('Las fechas deben tener el formato YYYY-MM-DD.');
  }
  if (params.fechaSalida <= params.fechaEntrada) {
    throw new Error('La fecha de salida debe ser posterior a la fecha de entrada.');
  }
  if (!Number.isInteger(params.adultos) || params.adultos < 1 || params.adultos > 9) {
    throw new Error('El número de adultos debe ser un entero entre 1 y 9.');
  }

  const { latitude, longitude } = await geocodificarDestino(params.destino);
  const response = await hotelbedsRequest<{
    hotels?: { hotels?: HotelbedsHotel[]; currency?: string; total?: number };
  }>('/hotel-api/1.0/hotels', 'POST', {
    stay: {
      checkIn: params.fechaEntrada,
      checkOut: params.fechaSalida,
    },
    occupancies: [{
      rooms: 1,
      adults: params.adultos,
      children: 0,
    }],
    geolocation: {
      latitude,
      longitude,
      radius: 20,
      unit: 'km',
    },
  });

  const hotelesRaw = response.hotels?.hotels ?? [];
  // Diagnostics let us distinguish hotels returned by Hotelbeds from hotels
  // that contain a usable consumer-facing selling price.
  const tarifasRaw = hotelesRaw.flatMap((hotel) =>
    (hotel.rooms ?? []).flatMap((room) => room.rates ?? []),
  );
  const tarifasConPrecioVenta = tarifasRaw.filter((rate) => {
    const price = Number(rate.sellingRate ?? rate.hotelSellingRate);
    return Number.isFinite(price) && price > 0;
  });
  const tarifasBookable = tarifasRaw.filter((rate) => rate.rateType === 'BOOKABLE');
  const tarifasRecheck = tarifasRaw.filter((rate) => rate.rateType === 'RECHECK');
  const hotelesConOfertaConPrecio = hotelesRaw.filter((hotel) =>
    (hotel.rooms ?? []).some((room) =>
      (room.rates ?? []).some((rate) => {
        const price = Number(rate.sellingRate ?? rate.hotelSellingRate);
        return Number.isFinite(price) && price > 0 &&
          (!rate.rateType || rate.rateType === 'BOOKABLE');
      }),
    ),
  ).length;
  const noches = Math.max(
    1,
    (Date.parse(`${params.fechaSalida}T00:00:00Z`) -
      Date.parse(`${params.fechaEntrada}T00:00:00Z`)) / 86400000,
  );

  const hoteles = hotelesRaw
    .map((hotel) => {
      const ofertas = (hotel.rooms ?? []).flatMap((room) =>
        (room.rates ?? []).map((rate) => ({
          roomName: room.name ?? '',
          rate,
          // Never expose "net" as the consumer price: Hotelbeds documents it
          // as a net amount in some pricing models. Only use an explicit
          // selling price returned by the availability API.
          price: Number(rate.sellingRate ?? rate.hotelSellingRate),
        })),
      ).filter((offer) =>
        Number.isFinite(offer.price) &&
        offer.price > 0 &&
        (!offer.rate.rateType || offer.rate.rateType === 'BOOKABLE'),
      ).sort((a, b) => a.price - b.price);

      const mejorOferta = ofertas[0];
      if (!hotel.name || !mejorOferta) return null;

      const cancellation = mejorOferta.rate.cancellationPolicies ?? [];
      // A zero cancellation amount is only treated as free cancellation
      // when Hotelbeds supplies a future deadline; missing dates are ambiguous.
      const freeCancellation = cancellation.some((policy) =>
        Number(policy.amount) === 0 &&
        typeof policy.from === 'string' &&
        Number.isFinite(Date.parse(policy.from)) &&
        Date.parse(policy.from) > Date.now(),
      );
      const starsMatch = (hotel.categoryCode ?? '').match(/^(\d+)/);
      const totalPrice = mejorOferta.price;

      return {
        nombre: hotel.name,
        estrellas: starsMatch ? Number(starsMatch[1]) : 0,
        valoracion: 0,
        numeroResenas: 0,
        precioTotal: totalPrice,
        precioPorNoche: Number((totalPrice / noches).toFixed(2)),
        moneda: mejorOferta.rate.hotelCurrency ?? hotel.currency ?? response.hotels?.currency ?? 'EUR',
        habitacion: mejorOferta.roomName,
        disponibilidad: 'Disponible según respuesta de Hotelbeds',
        habitacionesDisponibles: Number(mejorOferta.rate.allotment ?? 0),
        cancelacionGratuita: freeCancellation,
        cancelacionHasta: cancellation.find((policy) =>
          Number(policy.amount) === 0 && policy.from,
        )?.from ?? '',
        url: '',
        imagen: '',
        zona: hotel.zoneName ?? '',
        distanciaCentro: '',
      };
    })
    .filter((hotel): hotel is NonNullable<typeof hotel> => hotel !== null)
    .slice(0, 10);

  return {
    proveedor: 'Hotelbeds TEST',
    destino: params.destino,
    fechaEntrada: params.fechaEntrada,
    fechaSalida: params.fechaSalida,
    adultos: params.adultos,
    // This is a diagnostic count, not a claim that every returned hotel is bookable.
    totalHotelesDevueltos: hotelesRaw.length,
    diagnostico: {
      hotelesConHabitaciones: hotelesRaw.filter((hotel) => (hotel.rooms ?? []).length > 0).length,
      tarifasEncontradas: tarifasRaw.length,
      tarifasConPrecioVenta: tarifasConPrecioVenta.length,
      tarifasBookable: tarifasBookable.length,
      tarifasRecheck: tarifasRecheck.length,
      hotelesConOfertaConPrecio,
      motivoSiNoHayDetalle: hoteles.length > 0
        ? ''
        : tarifasRaw.length === 0
          ? 'Hotelbeds devolvió hoteles, pero no se encontraron habitaciones o tarifas en la respuesta interpretada.'
          : tarifasConPrecioVenta.length === 0
            ? 'Se encontraron tarifas, pero ninguna contiene sellingRate/hotelSellingRate utilizable; no se mostrará net como precio final.'
            : 'Hay tarifas, pero ninguna cumple los filtros actuales de tipo de tarifa y precio.',
    },
    hoteles,
  };
}
