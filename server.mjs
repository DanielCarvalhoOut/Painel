// Painel — central do estúdio. Núcleo pequeno: servidor HTTP, eventos ao vivo, processos, arquivos
// e um carregador de plugins. Tudo que é específico (PullCut, HyperFrames, FilmCraft, Colab…)
// mora em plugins/<id>/ e entra só criando a pasta. Só escuta em 127.0.0.1, sem dependências.
// As rotas estão em core/servidor.mjs; a proteção delas em core/seguranca.mjs.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acharFfmpeg } from './core/util.mjs';
import { criarServidor } from './core/servidor.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(ROOT, 'painel.config.json'), 'utf8').catch(() => '{}'));
const PORT = Number(process.env.PAINEL_PORT || config.porta || 4700);

const { servidor, plugins, encerrar } = await criarServidor({ root: ROOT, porta: PORT, config, ffmpegDir: acharFfmpeg() });

for (const sinal of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sinal, () => encerrar().finally(() => process.exit(0)));
}

servidor.listen(PORT, '127.0.0.1', () => {
  console.log(`Painel rodando em http://127.0.0.1:${PORT}`);
  for (const p of plugins) console.log(`  ${p.erro ? '[!]' : p.desativado ? '[ ]' : '[ok]'} ${p.m.nome}${p.erro ? ` — ${p.erro}` : p.desativado ? ' (desativado)' : ''}`);
});
