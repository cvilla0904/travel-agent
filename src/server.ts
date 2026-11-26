import express from 'express';
import { run, MemorySession } from '@openai/agents';
import { agenteParaModo } from './index.js';
import { mensajeConDestinoSeleccionado } from './services/destino-seleccionado.js';
import { turnoChat } from './services/chat-contrato.js';
import { resolverModo, validarModo, type ModoBusqueda, mensajeConFechasHotel, validarFechasHotel } from './services/modo-busqueda.js';

const app = express();

app.use(express.static('public'));
app.use(express.json());

const sessions = new Map<string, MemorySession>();
const modos = new Map<string, ModoBusqueda>();

app.post('/api/chat', async (req, res) => {
  try {
    const userMessage = req.body?.message;
    const sessionId = req.body?.sessionId;

    if (!userMessage || typeof userMessage !== 'string') {
      return res.status(400).json({
        error: 'Falta el mensaje.',
      });
    }

    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({
        error: 'Falta el identificador de sesión.',
      });
    }

    const validacion = validarModo(req.body?.modo);
    if (!validacion.ok) return res.status(validacion.status).json({ error: validacion.error });
    const modo = resolverModo(validacion.modo, modos.get(sessionId));
    const fechasHotel = validarFechasHotel(modo, req.body?.fechas);
    if (!fechasHotel.ok) return res.status(fechasHotel.status).json({ error: fechasHotel.error });

    let session = sessions.get(sessionId);

    if (!session) {
      session = new MemorySession();
      sessions.set(sessionId, session);
    }

    const turno = await turnoChat(req.body?.destinoSeleccionado, () => run(
      agenteParaModo(modo),
      mensajeConFechasHotel(mensajeConDestinoSeleccionado(userMessage, req.body?.destinoSeleccionado), fechasHotel.fechas),
      {
        session,
      },
    ));

    if (turno.status === 200) modos.set(sessionId, modo);

    return res.status(turno.status).json(turno.body);
  } catch (error: any) {
    console.error(error);

    return res.status(500).json({
      error: error?.message ?? 'Error interno.',
    });
  }
});

app.get('/', (_req, res) => {
  res.send('Travel Agent funcionando');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Travel Agent web escuchando en el puerto ${PORT}`,
  );
});