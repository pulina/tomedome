import { ChatMessage } from '@shared/types';
import { getLogger } from '../lib/logger';
import { getChat, setChatTitle } from './chat-service';
import { streamChat } from './llm-client';
import titleGenerationPrompt from '../prompts/title-generation.md?raw';

const UNDETERMINED = 'UNDETERMINED';

// Titles that are too generic to be useful — reject them so we keep retrying.
const GENERIC_TITLES = new Set([
  'greetings', 'greeting', 'hello', 'hi', 'introduction', 'introductions',
  'welcome', 'salutation', 'salutations', 'conversation', 'chat', 'inquiry',
  'question', 'small talk', 'pleasantries', 'opening', 'start',
]);

// Exactly three evaluation attempts — at message counts 2, 4, and 6.
// The first two are tentative (status stays 'pending', title can be replaced).
// The third is final ('determined', no further evaluation).
const ATTEMPT_AT = new Set([2, 4, 6]);
const FINAL_ATTEMPT = 6;

function buildTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.trim()}`)
    .join('\n\n');
}

function sanitise(raw: string): string | null {
  let t = raw.trim();
  if (!t) return null;
  // Strip <think>…</think> reasoning blocks.
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  t = t.replace(/<think>[\s\S]*/gi, '').trim();
  if (!t) return null;
  // Strip surrounding quotes, code fences, trailing punctuation.
  t = t.replace(/^["'`]+|["'`]+$/g, '').trim();
  t = t.replace(/[.!?]+$/g, '').trim();
  // Take only the first line.
  const title = (t.split(/\r?\n/)[0] ?? '').trim();
  if (!title) return null;
  // Reject generic titles — they add no value over "Unknown".
  if (GENERIC_TITLES.has(title.toLowerCase())) return null;
  if (title.length > 80) return title.slice(0, 80).trim();
  return title;
}

/**
 * Evaluates whether the chat has enough substance to title.
 * Called after every assistant response.
 *
 * Strategy:
 * - Skip until MIN_MESSAGES so we have real context to work with.
 * - Below FINALISE_AFTER: update the title but keep status 'pending' so a
 *   richer title can replace it as the conversation deepens.
 * - At or above FINALISE_AFTER: mark 'determined' and stop re-evaluating.
 * - 'locked' (user-set) is never touched.
 */
export async function evaluateTitle(
  chatId: string,
  messages: ChatMessage[],
): Promise<string | null> {
  const chat = getChat(chatId);
  if (!chat || chat.titleStatus === 'locked') return null;
  // Once finalised, stop — the title is stable.
  if (chat.titleStatus === 'determined') return null;
  // Only evaluate at the three designated message counts.
  if (!ATTEMPT_AT.has(messages.length)) return null;

  const log = getLogger().child({ module: 'title-service', chatId });
  const transcript = buildTranscript(messages);
  const prompt = titleGenerationPrompt.replace('{{TRANSCRIPT}}', transcript);

  try {
    const result = await streamChat({
      chatId,
      purpose: 'title',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 64,
    });
    const raw = result.text.trim();
    if (!raw || raw.toUpperCase().startsWith(UNDETERMINED) || raw.toLowerCase().startsWith('<think>')) {
      log.debug({ attempt: messages.length }, 'title undetermined');
      // Final attempt returned nothing — lock whatever tentative title we have so
      // we stop evaluating. If there's no title at all, leave it as Unknown.
      if (messages.length >= FINAL_ATTEMPT && chat.title && chat.title !== 'Unknown') {
        setChatTitle(chatId, chat.title, 'determined');
      }
      return null;
    }
    const title = sanitise(raw);
    if (!title) {
      log.debug('title rejected as generic; will retry on next message');
      return null;
    }

    const finalise = messages.length >= FINAL_ATTEMPT;
    setChatTitle(chatId, title, finalise ? 'determined' : 'pending');
    log.info({ title, attempt: messages.length, finalised: finalise }, 'title updated');
    return title;
  } catch (err) {
    log.warn({ err }, 'title generation failed');
    return null;
  }
}
