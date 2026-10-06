import express from 'express';
import { run, MemorySession, type AgentInputItem } from '@openai/agents';
import { Redis } from '@upstash/redis';
import { travelAgent } from '../src/index.js';

const app = express();

app.use(express.json());

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
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

    const history = await redis.get<AgentInputItem[]>(`chat:session:${sessionId}`);
    const session = new MemorySession({
      sessionId,
      initialItems: history ?? [],
    });

    const result = await run(
      travelAgent,
      userMessage,
      {
        session,
      },
    );

    await redis.set(
      `chat:session:${sessionId}`,
      await session.getItems(),
      { ex: SESSION_TTL_SECONDS },
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

export default app;
