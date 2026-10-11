import { createHash } from 'node:crypto';
import https from 'node:https';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

/**
 * Comprueba autenticación contra el endpoint de estado de Hotelbeds
 * usando el entorno de pruebas y mTLS.
 */
export async function comprobarConexionHotelbeds(): Promise<{
  ok: boolean;
  status: number;
  mensaje: string;
}> {
  const apiKey = requiredEnv('HOTELBEDS_API_KEY');
  const secret = requiredEnv('HOTELBEDS_API_SECRET');
  const cert = requiredEnv('HOTELBEDS_CLIENT_CERT');
  const key = requiredEnv('HOTELBEDS_CLIENT_KEY');
  const passphrase = requiredEnv('HOTELBEDS_CLIENT_KEY_PASSPHRASE');

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHash('sha256')
    .update(`${apiKey}${secret}${timestamp}`)
    .digest('hex');

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: 'api-mtls.test.hotelbeds.com',
        path: '/hotel-api/1.0/status',
        method: 'GET',
        cert,
        key,
        passphrase,
        headers: {
          Accept: 'application/json',
          'Api-key': apiKey,
          'X-Signature': signature,
        },
        timeout: 15000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          const status = response.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({
              ok: true,
              status,
              mensaje: 'Hotelbeds respondió correctamente al endpoint de estado de pruebas.',
            });
            return;
          }

          // Do not return provider response bodies; they may contain diagnostic details.
          resolve({
            ok: false,
            status,
            mensaje: `Hotelbeds devolvió HTTP ${status}. Revisa credenciales, asociación de certificado y permisos del entorno de pruebas.`,
          });
        });
      },
    );

    request.on('timeout', () => request.destroy(new Error('Tiempo de espera agotado al conectar con Hotelbeds.')));
    request.on('error', (error) => {
      reject(new Error(`No se pudo establecer la conexión mTLS con Hotelbeds: ${error.message}`));
    });
    request.end();
  });
}
