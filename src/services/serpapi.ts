export async function buscarGoogleFlights(params: {
  departureId: string;
  arrivalId: string;
  outboundDate: string;
  returnDate: string;
  adults: number;
  departureToken?: string;
}) {
  const apiKey = process.env.SERPAPI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'SERPAPI_API_KEY no está configurada.',
    );
  }

  const url = new URL(
    'https://serpapi.com/search.json',
  );

  url.searchParams.set(
    'engine',
    'google_flights',
  );

  url.searchParams.set(
    'departure_id',
    params.departureId,
  );

  url.searchParams.set(
    'arrival_id',
    params.arrivalId,
  );

  url.searchParams.set(
    'outbound_date',
    params.outboundDate,
  );

  url.searchParams.set(
    'return_date',
    params.returnDate,
  );

  url.searchParams.set(
    'adults',
    String(params.adults),
  );

  url.searchParams.set(
    'currency',
    'EUR',
  );

  if (params.departureToken) {
    url.searchParams.set(
      'departure_token',
      params.departureToken,
    );
  }

  url.searchParams.set(
    'api_key',
    apiKey,
  );

  const response = await fetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Error de SerpApi (${response.status}): ${errorText}`,
    );
  }

  return response.json();
}


export async function buscarGoogleTravelExplore(params: {
  departureId: string;
  outboundDate: string;
  returnDate: string;
}) {
  const apiKey =
    process.env.SERPAPI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'SERPAPI_API_KEY no está configurada.',
    );
  }

  const url = new URL(
    'https://serpapi.com/search.json',
  );

  url.searchParams.set(
    'engine',
    'google_travel_explore',
  );

  url.searchParams.set(
    'departure_id',
    params.departureId,
  );

  url.searchParams.set(
    'type',
    '1',
  );

  url.searchParams.set(
    'outbound_date',
    params.outboundDate,
  );

  url.searchParams.set(
    'return_date',
    params.returnDate,
  );

  url.searchParams.set(
    'currency',
    'EUR',
  );

  url.searchParams.set(
    'hl',
    'es',
  );

  url.searchParams.set(
    'gl',
    'es',
  );

  url.searchParams.set(
    'api_key',
    apiKey,
  );

  const response =
    await fetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Error de SerpApi Explore (${response.status}): ${errorText}`,
    );
  }

  return response.json();
}


export async function resolverAeropuerto(
  texto: string,
) {
  const apiKey =
    process.env.SERPAPI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'SERPAPI_API_KEY no está configurada.',
    );
  }

  const url = new URL(
    'https://serpapi.com/search.json',
  );

  url.searchParams.set(
    'engine',
    'google_flights_autocomplete',
  );

  url.searchParams.set(
    'q',
    texto,
  );

  url.searchParams.set(
    'hl',
    'es',
  );

  url.searchParams.set(
    'gl',
    'es',
  );

  url.searchParams.set(
    'exclude_regions',
    'true',
  );

  url.searchParams.set(
    'api_key',
    apiKey,
  );

  const response =
    await fetch(url);

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Error de SerpApi Autocomplete (${response.status}): ${errorText}`,
    );
  }

  const data =
    await response.json();

  return data.suggestions ?? [];
}