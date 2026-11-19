// DATOS DE PRUEBA (no son el catálogo real): fragmentos en el formato original de GeoNames y OurAirports,
// con coordenadas y poblaciones aproximadas, solo para ejercitar el motor. Sin red ni proveedores.
import fs from 'node:fs';
import path from 'node:path';
import { Catalogo, type Fuente } from '../src/geo/catalogo.ts';
import {
  aeropuertosComerciales, construirCatalogo, parsearCountryInfo, parsearCsv, parsearGeoNames,
} from '../src/geo/construir.ts';
import type { Destacados, Region } from '../src/geo/tipos.ts';

const root = path.resolve(import.meta.dirname, '..');
const dato = <T>(f: string) => JSON.parse(fs.readFileSync(path.join(root, 'src/geo/data', f), 'utf8')) as T;

const C: Array<[string, string, string, string, number, number, string, number]> = [
  // id, nombre, ascii, alternos, lat, lon, país, población
  ['3688689', 'Bogotá', 'Bogota', 'Bogota,Santa Fe de Bogota', 4.6097, -74.0817, 'CO', 7400000],
  ['3674962', 'Medellín', 'Medellin', 'Medellin', 6.2518, -75.5636, 'CO', 2500000],
  ['3672647', 'Rionegro', 'Rionegro', '', 6.1553, -75.3737, 'CO', 140000],
  ['3687925', 'Cali', 'Cali', 'Santiago de Cali', 3.4372, -76.5225, 'CO', 2200000],
  ['3687238', 'Cartagena', 'Cartagena', 'Cartagena de Indias', 10.3997, -75.5144, 'CO', 1000000],
  ['3689147', 'Barranquilla', 'Barranquilla', '', 10.9639, -74.7964, 'CO', 1200000],
  ['3668605', 'Santa Marta', 'Santa Marta', '', 11.2408, -74.199, 'CO', 500000],
  ['1850147', 'Tokyo', 'Tokyo', 'Tokio,Tōkyō,東京', 35.6895, 139.6917, 'JP', 8300000],
  ['1848354', 'Yokohama', 'Yokohama', '', 35.4333, 139.6333, 'JP', 3700000],
  ['2111149', 'Narita', 'Narita', '', 35.776, 140.318, 'JP', 130000],
  ['1853909', 'Osaka', 'Osaka', 'Osaka', 34.6937, 135.5022, 'JP', 2700000],
  ['1857910', 'Kyoto', 'Kyoto', 'Kioto,Kyōto', 35.0211, 135.7538, 'JP', 1460000],
  ['1856057', 'Nagoya', 'Nagoya', 'Nagoya', 35.1815, 136.9064, 'JP', 2300000],
  ['1863967', 'Fukuoka', 'Fukuoka', '', 33.5902, 130.4017, 'JP', 1500000],
  ['2128295', 'Sapporo', 'Sapporo', '', 43.0642, 141.3469, 'JP', 1900000],
  ['2127000', 'Chitose', 'Chitose', '', 42.8196, 141.6506, 'JP', 95000],
  ['2509951', 'Valencia', 'Valencia', 'Valencia', 39.4699, -0.3763, 'ES', 800000],
  ['3117735', 'Madrid', 'Madrid', '', 40.4165, -3.7026, 'ES', 3200000],
  ['3625549', 'Valencia', 'Valencia', 'Valencia', 10.162, -68.0077, 'VE', 1400000],
  ['2643743', 'London', 'London', 'Londres', 51.5085, -0.1257, 'GB', 8900000],
  ['6058560', 'London', 'London', '', 42.9834, -81.233, 'CA', 380000],
  ['3871336', 'Santiago', 'Santiago', 'Santiago de Chile', -33.4569, -70.6483, 'CL', 5100000],
  ['3536729', 'Santiago de Cuba', 'Santiago de Cuba', 'Santiago', 20.0217, -75.8294, 'CU', 430000],
  ['2800866', 'Brussels', 'Brussels', 'Bruxelles,Brussel,Bruselas', 50.8466, 4.3528, 'BE', 1100000],
  ['2803138', 'Antwerp', 'Antwerp', 'Anvers,Amberes,Antwerpen', 51.2198, 4.4021, 'BE', 500000],
  ['3191281', 'Sarajevo', 'Sarajevo', '', 43.8486, 18.3564, 'BA', 380000],
  ['3201047', 'Dubrovnik', 'Dubrovnik', '', 42.6507, 18.0944, 'HR', 42000],
  ['1269515', 'Jaipur', 'Jaipur', '', 26.9196, 75.7878, 'IN', 3000000],
  ['1273294', 'Delhi', 'Delhi', '', 28.6519, 77.2315, 'IN', 11000000],
  ['1275339', 'Mumbai', 'Mumbai', 'Bombay', 19.0144, 72.8479, 'IN', 12000000],
  ['1277333', 'Bengaluru', 'Bengaluru', 'Bangalore', 12.9719, 77.5937, 'IN', 8400000],
  ['1275004', 'Kolkata', 'Kolkata', 'Calcuta,Calcutta', 22.5697, 88.3697, 'IN', 4500000],
  ['3169070', 'Rome', 'Rome', 'Roma', 41.8919, 12.5113, 'IT', 2800000],
  ['3173435', 'Milan', 'Milan', 'Milano,Milán', 45.4643, 9.1895, 'IT', 1300000],
  ['3164603', 'Venice', 'Venice', 'Venezia,Venecia', 45.4375, 12.3358, 'IT', 260000],
  ['3172394', 'Naples', 'Naples', 'Napoli,Nápoles', 40.8522, 14.2681, 'IT', 960000],
  ['3176959', 'Florence', 'Florence', 'Firenze,Florencia', 43.7667, 11.25, 'IT', 370000],
  ['3170647', 'Pisa', 'Pisa', '', 43.7167, 10.4, 'IT', 90000],
];
const A: Array<[string, string, string, number, number, string, string, string]> = [
  // iata, nombre, tipo OurAirports, lat, lon, país, municipio, servicio
  ['BOG', 'El Dorado International Airport', 'large_airport', 4.7016, -74.1469, 'CO', 'Bogotá', 'yes'],
  ['MDE', 'José María Córdova International Airport', 'large_airport', 6.1645, -75.4231, 'CO', 'Rionegro', 'yes'],
  ['CLO', 'Alfonso Bonilla Aragón International Airport', 'large_airport', 3.5432, -76.3816, 'CO', 'Cali', 'yes'],
  ['CTG', 'Rafael Núñez International Airport', 'medium_airport', 10.4424, -75.513, 'CO', 'Cartagena', 'yes'],
  ['BAQ', 'Ernesto Cortissoz International Airport', 'medium_airport', 10.8896, -74.7808, 'CO', 'Barranquilla', 'yes'],
  ['SMR', 'Simón Bolívar International Airport', 'medium_airport', 11.1196, -74.2306, 'CO', 'Santa Marta', 'yes'],
  ['HND', 'Tokyo Haneda International Airport', 'large_airport', 35.5494, 139.7798, 'JP', 'Tokyo', 'yes'],
  ['NRT', 'Narita International Airport', 'large_airport', 35.7647, 140.3864, 'JP', 'Narita', 'yes'],
  ['KIX', 'Kansai International Airport', 'large_airport', 34.4273, 135.244, 'JP', 'Osaka', 'yes'],
  ['ITM', 'Osaka International Airport', 'medium_airport', 34.7855, 135.438, 'JP', 'Osaka', 'yes'],
  ['NGO', 'Chubu Centrair International Airport', 'large_airport', 34.8584, 136.8054, 'JP', 'Tokoname', 'yes'],
  ['FUK', 'Fukuoka Airport', 'large_airport', 33.5859, 130.4507, 'JP', 'Fukuoka', 'yes'],
  ['CTS', 'New Chitose Airport', 'large_airport', 42.7752, 141.6923, 'JP', 'Chitose', 'yes'],
  ['BRU', 'Brussels Airport', 'large_airport', 50.9014, 4.4844, 'BE', 'Brussels', 'yes'],
  ['SJJ', 'Sarajevo International Airport', 'medium_airport', 43.8246, 18.3315, 'BA', 'Sarajevo', 'yes'],
  ['DBV', 'Dubrovnik Airport', 'medium_airport', 42.5614, 18.2682, 'HR', 'Dubrovnik', 'yes'],
  ['JAI', 'Jaipur International Airport', 'medium_airport', 26.8242, 75.8122, 'IN', 'Jaipur', 'yes'],
  ['DEL', 'Indira Gandhi International Airport', 'large_airport', 28.5562, 77.1, 'IN', 'Delhi', 'yes'],
  ['BOM', 'Chhatrapati Shivaji Maharaj International Airport', 'large_airport', 19.0887, 72.8679, 'IN', 'Mumbai', 'yes'],
  ['BLR', 'Kempegowda International Airport', 'large_airport', 12.9941, 77.663, 'IN', 'Bengaluru', 'yes'],
  ['CCU', 'Netaji Subhas Chandra Bose International Airport', 'large_airport', 22.6547, 88.4467, 'IN', 'Kolkata', 'yes'],
  ['FCO', 'Leonardo da Vinci Fiumicino Airport', 'large_airport', 41.8003, 12.2389, 'IT', 'Rome', 'yes'],
  ['MXP', 'Malpensa International Airport', 'large_airport', 45.6306, 8.7281, 'IT', 'Milan', 'yes'],
  ['VCE', 'Marco Polo Airport', 'large_airport', 45.5053, 12.3519, 'IT', 'Venice', 'yes'],
  ['NAP', 'Naples International Airport', 'large_airport', 40.886, 14.2908, 'IT', 'Naples', 'yes'],
  ['FLR', 'Florence Airport, Peretola', 'medium_airport', 43.81, 11.2051, 'IT', 'Florence', 'yes'],
  ['PSA', 'Pisa International Airport', 'medium_airport', 43.6839, 10.3927, 'IT', 'Pisa', 'yes'],
  ['MAD', 'Adolfo Suárez Madrid–Barajas Airport', 'large_airport', 40.4936, -3.5668, 'ES', 'Madrid', 'yes'],
  ['XXS', 'Pequeño aeródromo', 'small_airport', 4.8, -74.1, 'CO', 'Bogotá', 'yes'],
  ['XXN', 'Aeropuerto sin servicio regular', 'medium_airport', 3.5, -76.4, 'CO', 'Cali', 'no'],
];
const PAISES: Array<[string, string, string, string, string]> = [
  ['CO', 'Colombia', 'es-CO,en', '3686110', ''], ['JP', 'Japan', 'ja', '1861060', ''], ['ES', 'Spain', 'es-ES,ca', '2510769', ''],
  ['VE', 'Venezuela', 'es-VE', '3625428', ''], ['GB', 'United Kingdom', 'en-GB', '2635167', ''], ['CA', 'Canada', 'en-CA,fr-CA', '6251999', ''],
  ['CL', 'Chile', 'es-CL', '3895114', ''], ['CU', 'Cuba', 'es-CU', '3562981', ''], ['BE', 'Belgium', 'nl-BE,fr-BE,de-BE', '2802361', ''],
  ['BA', 'Bosnia and Herzegovina', 'bs,hr-BA,sr-BA', '3277605', ''], ['HR', 'Croatia', 'hr-HR', '3202326', ''], ['IN', 'India', 'en-IN,hi', '1269750', ''],
  ['IT', 'Italy', 'it-IT', '3175395', ''],
];

export const textoGeoNames = () => C.map(([id, n, a, alt, lat, lon, cc, pop]) =>
  [id, n, a, alt, lat, lon, 'P', 'PPL', cc, '', '00', '', '', '', pop, '', 100, 'Etc/UTC', '2024-01-01'].join('\t')).join('\n');
export const textoCountryInfo = () => '# comentario\n' + PAISES.map(([iso, nom, idi, gid]) =>
  [iso, iso + 'X', '0', 'XX', nom, 'Cap', '1', '1', 'XX', '.xx', 'USD', 'Dollar', '1', '', '', idi, gid, '', ''].join('\t')).join('\n');
export const textoAeropuertos = () => 'id,ident,type,name,latitude_deg,longitude_deg,elevation_ft,continent,iso_country,iso_region,municipality,scheduled_service,icao_code,iata_code,gps_code,local_code\n' +
  A.map(([iata, n, t, lat, lon, cc, m, s], i) => `${i},X${i},${t},"${n}",${lat},${lon},0,XX,${cc},${cc}-X,"${m}",${s},,${iata},,`).join('\n');

export function catalogoDePrueba(opciones: { destacados?: Destacados } = {}): Catalogo {
  const r = construirCatalogo({
    geonames: parsearGeoNames(textoGeoNames()),
    paises: parsearCountryInfo(textoCountryInfo()),
    aeropuertos: aeropuertosComerciales(parsearCsv(textoAeropuertos())),
    nombresPaisCurados: dato('paises-curados.json'),
    regiones: dato<Region[]>('regiones.json'),
  });
  const fuente: Fuente = {
    indice: () => r.indice, paises: () => r.paises, pais: (iso) => r.shards[iso],
    regiones: () => dato<Region[]>('regiones.json'),
    destacados: () => opciones.destacados ?? dato<Destacados>('destacados.json'),
  };
  return new Catalogo(fuente);
}
export const sinDestacados: Destacados = { paises: {}, preferidos: {}, acceso: {} };
