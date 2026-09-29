import express from 'express';
import { run, MemorySession } from '@openai/agents';
import { travelAgent } from './index.js';

const app = express();

app.use(express.static('public'));
app.use(express.json());

const sessions = new Map<string, MemorySession>();

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

    let session = sessions.get(sessionId);

    if (!session) {
      session = new MemorySession();
      sessions.set(sessionId, session);
    }

    const result = await run(
      travelAgent,
      userMessage,
      {
        session,
      },
    );

    return res.json({
      response: result.finalOutput,
    });
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