// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { CancelledError, message } from './core/brok';
import { resolveHitPath } from './core/paths';
import type { AnswerDone, AnswerRequest, ConversationTurn, SearchHit, SourceRef } from './core/protocol';
import { cite, lastCause, llmUnavailable, parseRequest, type SessionTurn } from './core/text';
import type { MemoryStore } from './memory';
import type { BrokspaceModel } from './model';

const t = vscode.l10n.t;

/** What an answer streams to: the chat panel or VS Code's chat. */
export interface AnswerSink {
    progress(text: string): void;
    markdown(text: string): void;
}

/** How an answer ended. */
export interface Answered {
    text: string;
    done?: AnswerDone;
    /** Answered from the local index (no LLM, or it did not answer). */
    local?: boolean;
}

/**
 * One answer through brok: `brok ask` (with the conversation so far),
 * `brok review` or `brok skill run`, streamed to `sink`. A question the LLM
 * cannot answer (none configured, unreachable) gets what the local index
 * finds instead.
 */
export async function answer(
    model: BrokspaceModel,
    request: AnswerRequest,
    sink: AnswerSink,
    token: vscode.CancellationToken,
): Promise<Answered> {
    const root = model.root;
    if (!root || !model.ready) {
        throw new Error(t('Set up Brokspace in this folder first: Brokspace: Set Up Workspace.'));
    }
    if (request.kind === 'ask' && !model.ready.status.llm?.model) {
        return answerLocally(model, root, request.prompt, sink);
    }
    sink.progress(progressText(request));
    const id = crypto.randomUUID();
    const cancel = token.onCancellationRequested(() => model.brok.cancel(id));
    let text = '';
    try {
        const done = await model.brok.answer(id, root, request, (chunk) => {
            text += chunk;
            sink.markdown(chunk);
        });
        return { text, done };
    } catch (error) {
        if (error instanceof CancelledError || token.isCancellationRequested) {
            return { text };
        }
        if (request.kind === 'ask' && !text && llmUnavailable(message(error))) {
            return answerLocally(model, root, request.prompt, sink, message(error));
        }
        throw new Error(hint(message(error)));
    } finally {
        cancel.dispose();
    }
}

async function answerLocally(model: BrokspaceModel, root: string, prompt: string, sink: AnswerSink, reason?: string): Promise<Answered> {
    sink.progress(t('Searching the index…'));
    const hits = await model.brok.search(root, prompt, 8);
    const intro = reason
        ? t('Your LLM did not answer ({0}), so here is what the local index found.', lastCause(reason))
        : t('No LLM is set up, so here is what the local index found. Run `brok setup llm` to get written answers.');
    const text = hits.length ? intro : `${intro}\n\n${t('No results. Try other words, or check that the index is up to date.')}`;
    sink.markdown(text);
    return { text, done: { sources: hits.map(sourceOf) }, local: true };
}

export function sourceOf(hit: SearchHit): SourceRef {
    return { path: hit.path, start_line: hit.start_line, end_line: hit.end_line, symbol: hit.symbol ?? undefined };
}

function progressText(request: AnswerRequest): string {
    switch (request.kind) {
        case 'review':
            return t('Reviewing your changes with the code-review skill…');
        case 'skill':
            return t('Running the {0} skill…', request.name);
        default:
            return t('Searching the workspace and asking your model…');
    }
}

/** Turns common failures into the next step to take. */
function hint(text: string): string {
    if (/no answer from the agent|connection refused|LLM/i.test(text)) {
        return `${text}\n\n${t('Is your LLM running? Start Ollama or LM Studio, then run "Brokspace: Diagnostics".')}`;
    }
    if (/no Brokspace workspace/i.test(text)) {
        return `${text}\n\n${t('Run "Brokspace: Set Up Workspace" first.')}`;
    }
    return text;
}

// ---------------------------------------------------------------- @brokspace in VS Code's chat

/** Registers `@brokspace` where the editor has VS Code's chat API. */
export function registerChatParticipant(context: vscode.ExtensionContext, model: BrokspaceModel, memory: MemoryStore): void {
    const chat = (vscode as { chat?: typeof vscode.chat }).chat;
    if (typeof chat?.createChatParticipant !== 'function') {
        return;
    }
    const participant = chat.createChatParticipant('brokspace.agent', async (request, chatContext, stream, token) => {
        const root = model.root;
        const history = historyOf(chatContext.history);
        const text = request.prompt.trim();
        if (request.command === 'search') {
            return chatSearch(model, text, stream);
        }
        if (request.command === 'remember') {
            const saved = text ? await memory.save({ title: text, kind: 'note', source: 'vscode-chat' }) : undefined;
            stream.markdown(
                saved ? t('Remembered: {0}', saved.title) : t('Tell me what to remember: `/remember Orders are idempotent per cart id`'),
            );
            return {};
        }
        const prompt = request.command ? `/${request.command} ${text}` : text;
        const parsed = parseRequest(prompt, history);
        try {
            const result = await answer(model, parsed, { progress: (p) => stream.progress(p), markdown: (m) => stream.markdown(m) }, token);
            const sources = result.done?.sources ?? [];
            if (root && sources.length) {
                stream.markdown(`\n\n**${t('Sources')}**\n\n`);
                for (const source of sources) {
                    const uri = vscode.Uri.file(resolveHitPath(root, source.path));
                    const range = new vscode.Range(Math.max(0, source.start_line - 1), 0, Math.max(0, source.end_line - 1), 0);
                    stream.reference(new vscode.Location(uri, range));
                    stream.markdown('- ');
                    stream.anchor(new vscode.Location(uri, range), cite(source));
                    stream.markdown(source.symbol ? ` · ${source.symbol}\n` : '\n');
                }
            }
            if (parsed.kind === 'ask') {
                const turns: SessionTurn[] = [
                    ...pairsOf(chatContext.history),
                    { question: text, answer: result.text, sources: sources.map(cite) },
                ];
                void memory.saveSession(chatSessionId(turns[0].question), turns).catch(() => undefined);
            }
            return { metadata: { sources: sources.map(cite) } };
        } catch (error) {
            return { errorDetails: { message: message(error) } };
        }
    });
    participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.png');
    context.subscriptions.push(participant);
}

async function chatSearch(model: BrokspaceModel, query: string, stream: vscode.ChatResponseStream): Promise<vscode.ChatResult> {
    const root = model.root;
    if (!root || !query) {
        stream.markdown(t('What should I look for? `/search where do we validate tokens`'));
        return {};
    }
    stream.progress(t('Searching the index…'));
    const hits = await model.brok.search(root, query, 10);
    if (!hits.length) {
        stream.markdown(t('No results. Try other words, or check that the index is up to date.'));
        return {};
    }
    for (const hit of hits) {
        const uri = vscode.Uri.file(resolveHitPath(root, hit.path));
        const range = new vscode.Range(Math.max(0, hit.start_line - 1), 0, Math.max(0, hit.end_line - 1), 0);
        stream.markdown('- ');
        stream.anchor(new vscode.Location(uri, range), cite(hit));
        stream.markdown(hit.symbol ? ` · ${hit.symbol}\n` : '\n');
    }
    return {};
}

type HistoryTurn = vscode.ChatRequestTurn | vscode.ChatResponseTurn;

/** The conversation so far, as brok takes it (`--history`). */
function historyOf(history: readonly HistoryTurn[]): ConversationTurn[] {
    return pairsOf(history).flatMap((pair) => [
        { role: 'user' as const, content: pair.question },
        { role: 'assistant' as const, content: pair.answer },
    ]);
}

/** Questions to @brokspace and their answers (other participants and commands left out). */
function pairsOf(history: readonly HistoryTurn[]): SessionTurn[] {
    const pairs: SessionTurn[] = [];
    let question: string | undefined;
    for (const turn of history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            question = turn.participant === 'brokspace.agent' && !turn.command ? turn.prompt : undefined;
        } else if (question !== undefined && turn.participant === 'brokspace.agent') {
            const text = turn.response
                .map((part) => (part instanceof vscode.ChatResponseMarkdownPart ? part.value.value : ''))
                .join('')
                .split(`**${t('Sources')}**`)[0]
                .trim();
            const sources = (turn.result.metadata?.sources as string[] | undefined) ?? [];
            if (text) {
                pairs.push({ question, answer: text, sources });
            }
            question = undefined;
        }
    }
    return pairs;
}

/** A stable id for a conversation: its first question. */
export function chatSessionId(firstQuestion: string): string {
    return crypto.createHash('sha256').update(firstQuestion).digest('hex').slice(0, 16);
}
