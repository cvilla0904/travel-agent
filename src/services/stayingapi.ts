export async function buscarHotelesStayingApi(params: {
  destino: string;
  fechaEntrada: string;
  fechaSalida: string;
  adultos: number;
}) {
  const apiKey = process.env.STAYINGAPI_API_KEY;

  if (!apiKey) {
    throw new Error('STAYINGAPI_API_KEY no está configurada.');
  }

  const url = new URL('https://api.stayingapi.com/v1/search');

  url.searchParams.set('location', params.destino);
  url.searchParams.set('checkIn', params.fechaEntrada);
  url.searchParams.set('checkOut', params.fechaSalida);
  url.searchParams.set('adults', String(params.adultos));
  url.searchParams.set('children', '0');
  url.searchParams.set('currency', 'EUR');
  url.searchParams.set('platforms', 'google,booking');
  url.searchParams.set('limit', '10');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok && response.status !== 202) {
    const errorText = await response.text();

    throw new Error(
      `Error de StayingAPI (${response.status}): ${errorText}`
    );
  }

  let data = await response.json();

  // Si StayingAPI necesita procesamiento asíncrono,
  // esperamos y consultamos el job hasta completarlo.
  if (response.status === 202) {
    const jobId = data.data?.jobId;

    if (!jobId) {
      throw new Error('StayingAPI devolvió 202 pero no proporcionó jobId.');
    }

    const maxIntentos = 12;

    for (let intento = 0; intento < maxIntentos; intento++) {
      await new Promise((resolve) => setTimeout(resolve, 5000));

      const jobResponse = await fetch(
        `https://api.stayingapi.com/v1/jobs/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
          },
        }
      );

      if (!jobResponse.ok) {
        const errorText = await jobResponse.text();

        throw new Error(
          `Error consultando job de StayingAPI (${jobResponse.status}): ${errorText}`
        );
      }

      data = await jobResponse.json();

      const status = data.data?.status;

      if (status === 'completed') {
        return data.data.result ?? [];
      }

      if (status === 'failed') {
        throw new Error('StayingAPI no pudo completar la búsqueda de hoteles.');
      }
    }

    throw new Error(
      'StayingAPI tardó demasiado en completar la búsqueda de hoteles.'
    );
  }

  return data.data ?? [];
}