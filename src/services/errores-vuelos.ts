export type CodigoErrorVuelos = 'parametros' | 'configuracion' | 'proveedor' | 'formato';

/** Error con categoría, para distinguir "fallo del proveedor" de "parámetros no válidos". */
export class ErrorVuelos extends Error {
  constructor(public readonly codigo: CodigoErrorVuelos, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorVuelos';
  }
}
