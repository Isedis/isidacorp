import '@fontsource-variable/jetbrains-mono';
import './style.css';
import { App } from './ui/app';
import { splash } from './ui/splash';
import { ApiBackend } from './backends/api';
import { localStore } from './storage';

// The site build: the player's own API key, the campaign in this browser.
const root = document.getElementById('app')!;
void splash(document.body);
new App(root, new ApiBackend(), localStore);
