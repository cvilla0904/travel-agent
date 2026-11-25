import express from 'express';
import { run, MemorySession, type AgentInputItem } from '@openai/agents';
import { Redis } from '@upstash/redis';
import { travelAgent } from '../src/index.js';
import { mensajeConDestinoSeleccionado } from '../src/services/destino-seleccionado.js';
import { turnoChat } from '../src/services/chat-contrato.js';

const app = express();

app.use(express.json());

const redis = Redis.fromEnv();
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

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

    const mensajeAgente = mensajeConDestinoSeleccionado(userMessage, req.body?.destinoSeleccionado);

    const history = await redis.get<AgentInputItem[]>(`chat:session:${sessionId}`);
    const session = new MemorySession({
      sessionId,
      initialItems: history ?? [],
    });

    // El destino elegido (validado por el servidor) se fija para toda la ejecución y los resultados de las herramientas se
    // recogen como datos estructurados (chat-contrato.ts): la web los pinta sin interpretar el texto del modelo.
    const turno = await turnoChat(req.body?.destinoSeleccionado, () => run(
      travelAgent,
      mensajeAgente,
      {
        session,
      },
    ));

    if (turno.status === 200) {
      await redis.set(
        `chat:session:${sessionId}`,
        await session.getItems(),
        { ex: SESSION_TTL_SECONDS },
      );
    }

    return res.status(turno.status).json(turno.body);
  } catch (error: any) {
    console.error(error);

    return res.status(500).json({
      error: error?.message ?? 'Error interno.',
    });
  }
});

export default app;
