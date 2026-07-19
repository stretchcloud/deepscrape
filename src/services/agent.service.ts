import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';
import { sessionManager } from './session-manager.service';
import { LLMServiceFactory } from './llm-service-factory';
import { OpenAIService } from './openai.service';

/**
 * Autonomous navigation agent.
 *
 * Given a natural-language goal and a starting URL, the agent drives a real
 * persistent browser session in a bounded observe -> decide -> act loop:
 *   1. observe   — read the current page as fit-markdown + a labelled link list
 *   2. decide    — an LLM picks the next action (navigate / click / type / finish)
 *   3. act       — execute it against the session, then repeat
 * until it decides to finish or hits the step budget, then extracts a final
 * structured (schema) or textual answer.
 *
 * Reliability bounds: hard step cap, per-action timeouts (via the session layer),
 * SSRF-guarded navigation (enforced by the session layer), a strict JSON action
 * contract validated before execution, and guaranteed session teardown.
 */

export interface AgentParams {
  url: string;
  prompt: string;                 // the goal
  schema?: Record<string, any>;   // optional JSON schema for the final answer
  maxSteps?: number;
  onlyMainContent?: boolean;
  fitMarkdown?: boolean;
}

export interface AgentStep {
  step: number;
  url: string;
  thought?: string;
  action: { type: string; [k: string]: any };
  error?: string;
}

export interface AgentResult {
  goal: string;
  completed: boolean;
  reason: string;
  finalUrl: string;
  steps: AgentStep[];
  answer?: string;
  data?: any;
}

const MAX_STEPS_CAP = Number(process.env.AGENT_MAX_STEPS_CAP ?? 20);
const OBS_MARKDOWN_CHARS = Number(process.env.AGENT_OBS_CHARS ?? 3500);
const OBS_MAX_LINKS = Number(process.env.AGENT_MAX_LINKS ?? 40);

const ALLOWED_ACTIONS = new Set(['navigate', 'click', 'type', 'scroll', 'wait', 'finish']);

const SYSTEM_PROMPT = `You are a web navigation agent. You are given a GOAL and you drive a real browser one step at a time to accomplish it.

At each step you receive the current page (as markdown) and a numbered list of links on the page. Respond with STRICT JSON only, no prose:
{
  "thought": "one short sentence of reasoning",
  "action": { "type": "navigate|click|type|scroll|wait|finish", ...fields }
}

Action fields:
- navigate: { "type":"navigate", "url":"<absolute url, ideally one from the LINKS list>" }
- click:    { "type":"click", "selector":"<css selector>" }
- type:     { "type":"type", "selector":"<css selector>", "text":"<text to enter>" }
- scroll:   { "type":"scroll" }
- wait:     { "type":"wait", "timeout":<ms> }
- finish:   { "type":"finish", "reason":"<why you are done>" }

Rules:
- Prefer navigating to links from the LINKS list to reach the information the GOAL needs.
- Choose "finish" as soon as the current page contains enough information to answer the GOAL. Do not keep navigating once the answer is visible.
- Only output the JSON object. Never output anything else.`;

interface LabeledLink { text: string; url: string; }

function extractLabeledLinks(html: string, pageUrl: string): LabeledLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const links: LabeledLink[] = [];
  $('a[href]').each((_, el) => {
    if (links.length >= OBS_MAX_LINKS) return;
    const href = $(el).attr('href') || '';
    let abs: string;
    try {
      abs = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(abs) || seen.has(abs)) return;
    const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!text) return;
    seen.add(abs);
    links.push({ text, url: abs });
  });
  return links;
}

/** Read the current page: markdown (truncated) + labelled links. */
async function observe(sessionId: string, params: AgentParams): Promise<{ url: string; title: string; markdown: string; links: LabeledLink[] }> {
  const res = await sessionManager.runAction(sessionId, {
    type: 'scrape',
    formats: ['markdown', 'html'],
    onlyMainContent: params.onlyMainContent,
    fitMarkdown: params.fitMarkdown,
  });
  const md: string = (res.markdown || '').slice(0, OBS_MARKDOWN_CHARS);
  const links = extractLabeledLinks(res.html || '', res.url || params.url);
  return { url: res.url || params.url, title: res.title || '', markdown: md, links };
}

function buildObservationMessage(params: AgentParams, obs: Awaited<ReturnType<typeof observe>>, step: number, maxSteps: number): string {
  const linkList = obs.links.map((l, i) => `${i + 1}. ${l.text} -> ${l.url}`).join('\n') || '(no links found)';
  return [
    `GOAL: ${params.prompt}`,
    `STEP: ${step}/${maxSteps}`,
    `CURRENT URL: ${obs.url}`,
    `PAGE TITLE: ${obs.title}`,
    '',
    'PAGE CONTENT (markdown, may be truncated):',
    obs.markdown || '(empty)',
    '',
    'LINKS ON PAGE:',
    linkList,
  ].join('\n');
}

interface Decision { thought?: string; action: { type: string; [k: string]: any }; }

async function decide(llm: OpenAIService, system: string, observation: string): Promise<Decision> {
  const resp = await llm.getCompletion<Decision>(
    [{ role: 'system', content: system }, { role: 'user', content: observation }],
    { temperature: 0, maxTokens: 500 },
    { type: 'json_object' }
  );
  if (!resp.success || !resp.data || typeof resp.data !== 'object') {
    throw new Error(resp.error || 'agent LLM returned no decision');
  }
  const decision = resp.data as Decision;
  const action = decision.action;
  if (!action || typeof action.type !== 'string' || !ALLOWED_ACTIONS.has(action.type)) {
    // Malformed / unknown action -> stop rather than execute something undefined.
    return { thought: decision.thought, action: { type: 'finish', reason: 'invalid action from model' } };
  }
  return decision;
}

/** Produce the final answer: schema-structured if a schema was given, else text. */
async function finalize(
  llm: OpenAIService,
  params: AgentParams,
  obs: Awaited<ReturnType<typeof observe>>
): Promise<{ answer?: string; data?: any }> {
  if (params.schema) {
    const resp = await llm.getCompletion<any>(
      [
        { role: 'system', content: 'Extract the requested data from the page as STRICT JSON matching the given schema. Output only the JSON object.' },
        { role: 'user', content: `GOAL: ${params.prompt}\n\nJSON SCHEMA:\n${JSON.stringify(params.schema)}\n\nPAGE (${obs.url}):\n${obs.markdown}` },
      ],
      { temperature: 0, maxTokens: 1500 },
      { type: 'json_object' }
    );
    return { data: resp.success ? resp.data : undefined, answer: resp.success ? undefined : (resp.error || 'extraction failed') };
  }
  const resp = await llm.getCompletion<string>(
    [
      { role: 'system', content: 'Answer the GOAL concisely using only the page content. If the answer is not present, say so.' },
      { role: 'user', content: `GOAL: ${params.prompt}\n\nPAGE (${obs.url}):\n${obs.markdown}` },
    ],
    { temperature: 0, maxTokens: 800 }
  );
  return { answer: resp.success ? String(resp.data) : (resp.error || 'no answer') };
}

function toSessionAction(action: { type: string; [k: string]: any }): any {
  switch (action.type) {
    case 'navigate': return { type: 'navigate', url: action.url };
    case 'click': return { type: 'click', selector: action.selector };
    case 'type': return { type: 'type', selector: action.selector, text: action.text ?? action.value };
    case 'scroll': return { type: 'scroll', position: action.position };
    case 'wait': return { type: 'wait', timeout: Math.min(Number(action.timeout) || 1000, 15000) };
    default: return null;
  }
}

export async function runAgent(params: AgentParams): Promise<AgentResult> {
  if (!params?.url || !params?.prompt) {
    throw new Error('agent requires `url` and `prompt`');
  }
  const llm = LLMServiceFactory.createLLMService();
  if (!llm) {
    throw new Error('Agent requires an LLM (set OPENAI_API_KEY or an LLM provider)');
  }

  const maxSteps = Math.max(1, Math.min(params.maxSteps ?? 8, MAX_STEPS_CAP));
  const steps: AgentStep[] = [];

  const session = await sessionManager.createSession({ initialUrl: params.url });
  logger.info(`Agent started (session ${session.id}) goal="${params.prompt.slice(0, 80)}"`);

  try {
    let lastObs = await observe(session.id, params);

    for (let i = 1; i <= maxSteps; i++) {
      const observation = buildObservationMessage(params, lastObs, i, maxSteps);
      const decision = await decide(llm, SYSTEM_PROMPT, observation);
      const step: AgentStep = { step: i, url: lastObs.url, thought: decision.thought, action: decision.action };

      if (decision.action.type === 'finish') {
        steps.push(step);
        const final = await finalize(llm, params, lastObs);
        logger.info(`Agent finished at step ${i}: ${decision.action.reason ?? ''}`);
        return { goal: params.prompt, completed: true, reason: decision.action.reason ?? 'finished', finalUrl: lastObs.url, steps, ...final };
      }

      const sessionAction = toSessionAction(decision.action);
      if (!sessionAction) {
        step.error = `unsupported action ${decision.action.type}`;
        steps.push(step);
        break;
      }
      try {
        await sessionManager.runAction(session.id, sessionAction);
      } catch (err) {
        step.error = (err as Error).message;
      }
      steps.push(step);

      lastObs = await observe(session.id, params);
    }

    // Ran out of steps — return a best-effort answer from the last page.
    const final = await finalize(llm, params, lastObs);
    return { goal: params.prompt, completed: false, reason: `reached step budget (${maxSteps})`, finalUrl: lastObs.url, steps, ...final };
  } finally {
    await sessionManager.closeSession(session.id);
  }
}
