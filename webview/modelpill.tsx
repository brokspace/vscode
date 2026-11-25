// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import * as React from 'react';
import type { BrokConfig } from '../src/core/protocol';
import type { SettingsSection } from '../src/webview-protocol';
import { codicon, type Host, t } from './host';
import { type MenuItem, PopMenu } from './menu';

/**
 * The model the answers come from, as a pill: a menu to switch between the
 * configured providers (or ask the index alone for one question), or, with no
 * model, an inviting badge that opens the model setup.
 */
export function ModelPill({
    host,
    model,
    onOpenSettings,
    onIndexOnly,
}: {
    host: Host;
    model: string | undefined;
    onOpenSettings: (section?: SettingsSection) => void;
    onIndexOnly: () => void;
}): React.ReactElement {
    const [config, setConfig] = React.useState<BrokConfig['llm'] | undefined>();
    const [failed, setFailed] = React.useState(false);

    if (!model) {
        return (
            <button
                type="button"
                className="bk-pill bk-pill-action"
                title={t('Answers come from the index. Connect an LLM to get written answers.')}
                onClick={() => onOpenSettings('model')}
            >
                <span className={codicon('plug')} aria-hidden="true" />
                <span className="bk-pill-text">{t('Index-only · Connect LLM')}</span>
            </button>
        );
    }

    const load = () => {
        setFailed(false);
        host.rpc<BrokConfig>('config').then(
            (loaded) => setConfig(loaded.llm),
            () => setFailed(true),
        );
    };
    const choose = (name: string) => {
        host.rpc('setConfig', 'llm.default', name).then(
            () => host.rpc('refresh'),
            (error: Error) => host.notify('error', error.message),
        );
    };
    const providers = Object.entries(config?.providers ?? {}).sort(([a], [b]) => a.localeCompare(b));
    const items: MenuItem[] = [
        ...providers.map(([name, provider]) => ({
            id: `p-${name}`,
            label: provider.model,
            hint: name,
            checked: name === config?.default,
            run: () => choose(name),
        })),
        ...(!config && !failed ? [{ id: 'loading', label: t('Loading…'), disabled: true, run: () => undefined }] : []),
        ...(failed ? [{ id: 'failed', label: t('Could not read the models'), disabled: true, run: () => undefined }] : []),
        { id: 'index', icon: 'search', label: t('Ask the index only, this once'), hint: '/search', divider: true, run: onIndexOnly },
        { id: 'manage', icon: 'settings-gear', label: t('Manage models…'), run: () => onOpenSettings('model') },
    ];
    return (
        <PopMenu
            label={t('Model: {0}. Switch model', model)}
            triggerClassName="bk-pill"
            trigger={
                <>
                    <span className="bk-pill-text">{model}</span>
                    <span className={codicon('chevron-down')} aria-hidden="true" />
                </>
            }
            items={items}
            onOpen={load}
        />
    );
}
