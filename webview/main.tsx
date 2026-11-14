// Brokspace for VS Code. SPDX-License-Identifier: MIT OR Apache-2.0

import { createRoot } from 'react-dom/client';
import { ChatApp } from './chat';
import { Host } from './host';
import { SettingsApp } from './settings';
import './style.css';

const host = new Host();
document.body.classList.add(`page-${host.boot.page}`);
const root = createRoot(document.getElementById('root') as HTMLElement);
root.render(host.boot.page === 'chat' ? <ChatApp host={host} /> : <SettingsApp host={host} />);
host.start();
