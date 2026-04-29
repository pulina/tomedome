import { FastifyInstance } from 'fastify';
import {
  addMessage,
  createChat,
  deleteChat,
  deleteMessagesFrom,
  getChat,
  getMessageToolEventLabels,
  getMessages,
  listChats,
  setChatTitle,
} from '../services/chat-service';
import { streamChat } from '../services/llm-client';
import { getLogger } from '../lib/logger';
import { getChatContextAvailability } from '../lib/chat-context-availability';
import { streamChatAssistantReply } from '../services/chat-stream-service';
import { apiErr } from '../lib/api-errors';
import { schemas } from './schemas';

export async function registerChatRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/chats', async () => listChats());

  fastify.get(
    '/api/chats/context-availability',
    { schema: { querystring: schemas.contextAvailabilityQuery } },
    async (req) => getChatContextAvailability((req.query as { seriesId?: string }).seriesId),
  );

  fastify.post('/api/chats', async () => createChat());

  fastify.delete<{ Params: { id: string } }>(
    '/api/chats/:id',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      deleteChat(req.params.id);
      return reply.code(204).send();
    },
  );

  fastify.put<{ Params: { id: string }; Body: { title: string } }>(
    '/api/chats/:id/title',
    { schema: { params: schemas.idParam, body: schemas.chatTitleBody } },
    async (req, reply) => {
      const title = req.body.title.trim();
      if (!title) return reply.code(400).send(apiErr('validation', 'title required'));
      setChatTitle(req.params.id, title.slice(0, 120), 'locked');
      return getChat(req.params.id);
    },
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/chats/:id/messages',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const chat = getChat(req.params.id);
      if (!chat) return reply.code(404).send(apiErr('not_found', 'not found'));
      const id = req.params.id;
      const messages = getMessages(id);
      return {
        messages,
        toolEventLabels: getMessageToolEventLabels(id, messages),
      };
    },
  );

  fastify.delete<{ Params: { id: string; messageId: string } }>(
    '/api/chats/:id/messages/from/:messageId',
    { schema: { params: schemas.chatMessageFromParam } },
    async (req, reply) => {
      const { id: chatId, messageId } = req.params;
      const chat = getChat(chatId);
      if (!chat) return reply.code(404).send(apiErr('not_found', 'chat not found'));
      deleteMessagesFrom(chatId, messageId);
      return reply.code(204).send();
    },
  );

  fastify.post<{ Params: { id: string }; Body: { content: string; seriesId?: string } }>(
    '/api/chats/:id/messages',
    { schema: { params: schemas.idParam, body: schemas.chatMessageBody } },
    async (req, reply) => {
      const chatId = req.params.id;
      const content = req.body.content.trim();
      const seriesId = req.body.seriesId ?? null;
      if (!content) return reply.code(400).send(apiErr('validation', 'content required'));
      const chat = getChat(chatId);
      if (!chat) return reply.code(404).send(apiErr('not_found', 'chat not found'));

      try {
        await streamChatAssistantReply({ req, reply, chatId, content, seriesId });
      } catch (err) {
        getLogger().error({ err, chatId }, 'chat message handler failed before SSE');
        if (!reply.sent) {
          return reply
            .code(500)
            .send(apiErr('internal', err instanceof Error ? err.message : 'Chat failed'));
        }
      }
    },
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/chats/:id/compact',
    { schema: { params: schemas.idParam } },
    async (req, reply) => {
      const chatId = req.params.id;
      const chat = getChat(chatId);
      if (!chat) return reply.code(404).send(apiErr('not_found', 'chat not found'));

      const allMessages = getMessages(chatId);
      const lastCompactionIdx = allMessages.map((m) => m.role).lastIndexOf('compaction');
      const toSummarise = allMessages
        .slice(lastCompactionIdx + 1)
        .filter((m) => m.role === 'user' || m.role === 'assistant');

      if (toSummarise.length < 2) {
        return reply.code(400).send(apiErr('validation', 'not enough messages to compact'));
      }

      const convText = toSummarise
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      const result = await streamChat({
        chatId,
        purpose: 'compact',
        messages: [
          {
            role: 'system',
            content:
              'You summarise conversations for context compaction. Produce a dense, information-preserving summary capturing all topics discussed, questions asked, answers given, and any conclusions or important details. Write in third person, past tense. Be thorough yet concise.',
          },
          {
            role: 'user',
            content: `Summarise the following conversation:\n\n${convText}`,
          },
        ],
        maxTokens: 2048,
      });

      if (result.error && result.error !== 'aborted') {
        return reply.code(500).send(apiErr('internal', result.error ?? 'compact failed'));
      }

      const compactionMessage = addMessage(chatId, 'compaction', result.text.trim(), result.llmCallId);
      return { compactionMessage };
    },
  );
}
