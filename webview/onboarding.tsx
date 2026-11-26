// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import type * as React from 'react';
import { checklist, type Progress, type Step, type StepId } from '../src/core/onboarding';
import type { SettingsSection } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';

const ICON: Record<Step['status'], string> = {
    done: 'pass-filled',
    current: 'arrow-circle-right',
    todo: 'circle-large-outline',
    skipped: 'debug-step-over',
};

function title(id: StepId): string {
    switch (id) {
        case 'local':
            return t('How your data is handled');
        case 'brok':
            return t('Install brok');
        case 'folder':
            return t('Open a project folder');
        case 'workspace':
            return t('Set up this folder');
        case 'model':
            return t('Choose a model');
        case 'first':
            return t('Ask your first question');
        case 'memory':
            return t('Keep a memory');
        case 'mcp':
            return t('Share it with your coding agents');
        case 'links':
            return t('Link another repository');
    }
}

/**
 * The guided first run: a checklist with what is done, what is next and what
 * is optional. Required steps follow the real state of brok and the folder;
 * optional ones can be skipped and resumed.
 */
export function Onboarding({
    host,
    progress,
    mcpEnabled,
    onOpenSettings,
    onSuggest,
}: {
    host: Host;
    progress: Progress;
    mcpEnabled: boolean;
    onOpenSettings: (section?: SettingsSection) => void;
    onSuggest: (text: string) => void;
}): React.ReactElement {
    const state = host.state;
    const steps = checklist(state, progress, mcpEnabled);
    const required = steps.filter((step) => !step.optional);
    const finished = required.filter((step) => step.status === 'done').length;
    const command =
        (name: string, ...args: unknown[]) =>
        () =>
            host.command(name, ...args);
    const button = (label: string, onClick: () => void, primary = true) => (
        <button type="button" key={label} className={primary ? 'bk-button' : 'bk-button bk-button-secondary'} onClick={onClick}>
            {label}
        </button>
    );
    const skip = (id: StepId) => button(t('Skip for now'), () => host.post({ type: 'onboarding/skip', step: id }), false);

    const body = (step: Step): React.ReactNode => {
        switch (step.id) {
            case 'local':
                return (
                    <>
                        <p>
                            {t(
                                'Search, memory and the index stay on this machine. A question goes only to the model you choose, which can run locally, and only with the files you attach.',
                            )}
                        </p>
                        <div className="bk-buttons">{button(t('Got it'), () => host.post({ type: 'onboarding/acknowledge' }))}</div>
                    </>
                );
            case 'brok':
                return (
                    <>
                        <p>
                            {state.kind === 'outdated'
                                ? t(
                                      'The brok found here is too old for this extension. Installing downloads a compatible brok and brok-agent, only after you confirm.',
                                  )
                                : t(
                                      'Brokspace runs through brok and brok-agent. Installing downloads both from GitHub after you confirm, checks them and keeps them in the extension folder.',
                                  )}
                        </p>
                        <p className="bk-onboarding-hint">
                            {t(
                                'Offline, or you prefer a package manager? Use the install guide (Homebrew, APT or the release binary), then reload.',
                            )}
                        </p>
                        <div className="bk-buttons">
                            {button(t('Install brok'), command('brokspace.installBrok'))}
                            {button(t('Install guide'), command('brokspace.installHelp'), false)}
                        </div>
                    </>
                );
            case 'folder':
                return (
                    <>
                        <p>{t('Brokspace works on a folder: open the project, or the folder that holds several repositories.')}</p>
                        <div className="bk-buttons">{button(t('Open a folder'), command('workbench.action.files.openFolder'))}</div>
                    </>
                );
            case 'workspace':
                return (
                    <>
                        {state.kind === 'error' ? (
                            <p role="alert">{t('Brokspace could not read this folder: {0}', state.message)}</p>
                        ) : (
                            <p>
                                {t(
                                    'Creates .brokspace/brok.yml and indexes the folder, with progress you can cancel. Nothing in your code is changed, and an existing setup is kept.',
                                )}
                            </p>
                        )}
                        <div className="bk-buttons">
                            {button(state.kind === 'error' ? t('Try again') : t('Set up this folder'), command('brokspace.setup'))}
                            {state.kind === 'error' && button(t('Run the doctor'), command('brokspace.doctor'), false)}
                        </div>
                    </>
                );
            case 'model':
                return (
                    <>
                        <p>
                            {t(
                                'Optional. A model (Ollama, LM Studio or any OpenAI-compatible API) writes the answers. Without one, search and answers from the index still work.',
                            )}
                        </p>
                        <div className="bk-buttons">
                            {button(t('Choose a model'), () => onOpenSettings('model'))}
                            {button(t('Check the connection'), command('brokspace.doctor'), false)}
                            {skip(step.id)}
                        </div>
                    </>
                );
            case 'first':
                return (
                    <>
                        <p>{t('Ready. Ask something about this folder: the answer cites the code it comes from.')}</p>
                        <div className="bk-buttons">
                            {button(t('How is this project structured?'), () => onSuggest(t('How is this project structured?')))}
                            {button(t('Search the code'), command('brokspace.search'), false)}
                        </div>
                    </>
                );
            case 'memory':
                return (
                    <>
                        <p>{t('Optional. Save a decision or a convention once and it comes back in later answers and in your agents.')}</p>
                        <div className="bk-buttons">
                            {button(t('Open Memory'), () => onOpenSettings('memory'))}
                            {skip(step.id)}
                        </div>
                    </>
                );
            case 'mcp':
                return (
                    <>
                        <p>
                            {t(
                                'Optional. Registers Brokspace with Copilot agent mode and other MCP clients so they can search and remember.',
                            )}
                        </p>
                        <div className="bk-buttons">
                            {button(t('Turn it on'), command('workbench.action.openSettings', 'brokspace.mcp.enabled'))}
                            {skip(step.id)}
                        </div>
                    </>
                );
            case 'links':
                return (
                    <>
                        <p>{t('Optional. Link a folder or a Git repository (for example a service you call) and search both.')}</p>
                        <div className="bk-buttons">
                            {button(t('Link a repository'), () => onOpenSettings('links'))}
                            {skip(step.id)}
                        </div>
                    </>
                );
        }
    };

    const row = (step: Step) => (
        <li key={step.id} className={`bk-guide bk-guide-${step.status}`} aria-current={step.status === 'current' ? 'step' : undefined}>
            <div className="bk-guide-head">
                <span className={codicon(ICON[step.status])} aria-hidden="true" />
                <span className="bk-guide-title">{title(step.id)}</span>
                <span className="bk-guide-state">
                    {step.status === 'done' && t('Done')}
                    {step.status === 'skipped' && t('Skipped')}
                    {step.optional && step.status !== 'done' && step.status !== 'skipped' && t('Optional')}
                </span>
                {step.status === 'skipped' && (
                    <button
                        type="button"
                        className="bk-link-button"
                        onClick={() => host.post({ type: 'onboarding/resume', step: step.id })}
                    >
                        {t('Resume')}
                    </button>
                )}
            </div>
            {(step.status === 'current' || (step.optional && step.status === 'todo')) && <div className="bk-guide-body">{body(step)}</div>}
        </li>
    );

    return (
        <section className="bk-onboarding" aria-label={t('Getting started')}>
            <header className="bk-onboarding-head">
                <h2>{t('Getting started')}</h2>
                <span className="bk-onboarding-count">{t('{0} of {1} done', String(finished), String(required.length))}</span>
                <button
                    type="button"
                    className={`bk-icon-button ${codicon('close')}`}
                    title={t('Hide the checklist')}
                    aria-label={t('Hide the checklist')}
                    onClick={() => host.post({ type: 'onboarding/dismiss' })}
                />
            </header>
            <progress className="bk-onboarding-bar" max={required.length} value={finished} aria-label={t('Getting started')} />
            <ol className="bk-guides">{steps.filter((step) => !step.optional).map(row)}</ol>
            {state.kind === 'ready' && (
                <>
                    <h3 className="bk-onboarding-sub">{t('Optional next steps')}</h3>
                    <ol className="bk-guides">{steps.filter((step) => step.optional).map(row)}</ol>
                </>
            )}
            <p className="bk-onboarding-hint">{t('Run Brokspace: Get Started to see this again.')}</p>
        </section>
    );
}
