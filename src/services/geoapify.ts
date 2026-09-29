export async function buscarLugaresGeoapify(params: {
  destino: string;
  categoria: string;
}) {
  const apiKey = process.env.GEOAPIFY_API_KEY;

  if (!apiKey) {
    throw new Error('GEOAPIFY_API_KEY no está configurada.');
  }

  // 1. Buscamos el destino y obtenemos su place_id
  const geocodeUrl = new URL(
    'https://api.geoapify.com/v1/geocode/search'
  );

  geocodeUrl.searchParams.set('text', params.destino);
  geocodeUrl.searchParams.set('type', 'city');
  geocodeUrl.searchParams.set('limit', '1');
  geocodeUrl.searchParams.set('apiKey', apiKey);

  const geocodeResponse = await fetch(geocodeUrl);

  if (!geocodeResponse.ok) {
    const errorText = await geocodeResponse.text();

    throw new Error(
      `Error de Geoapify Geocoding (${geocodeResponse.status}): ${errorText}`
    );
  }

  const geocodeData = await geocodeResponse.json();
  const lugar = geocodeData.features?.[0];

  if (!lugar?.properties?.place_id) {
    throw new Error(
      `No se ha encontrado el destino "${params.destino}".`
    );
  }

  const placeId = lugar.properties.place_id;

  // 2. Buscamos lugares dentro de la ciudad
  const placesUrl = new URL(
    'https://api.geoapify.com/v2/places'
  );

  placesUrl.searchParams.set('categories', params.categoria);
  placesUrl.searchParams.set('filter', `place:${placeId}`);
  placesUrl.searchParams.set('limit', '10');
  placesUrl.searchParams.set('lang', 'es');
  placesUrl.searchParams.set('apiKey', apiKey);

  const placesResponse = await fetch(placesUrl);

  if (!placesResponse.ok) {
    const errorText = await placesResponse.text();

    throw new Error(
      `Error de Geoapify Places (${placesResponse.status}): ${errorText}`
    );
  }

  const placesData = await placesResponse.json();

  return placesData.features ?? [];
}