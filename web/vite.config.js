import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

/**
 * Serves the Vercel-style functions in /api during `vite dev`, so the whole app
 * (quotes, status, Alajo) runs from one command without the Vercel CLI.
 */
function localApi(env) {
  return {
    name: 'ajo-local-api',
    configureServer(server) {
      Object.assign(process.env, env);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const name = url.pathname.replace('/api/', '').replace(/[^a-z0-9-]/gi, '');
        try {
          const file = path.join(root, 'api', `${name}.js`);
          const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          req.query = Object.fromEntries(url.searchParams);
          if (req.method === 'POST') {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const raw = Buffer.concat(chunks).toString('utf8');
            req.body = raw ? JSON.parse(raw) : {};
          }
          res.status = (code) => { res.statusCode = code; return res; };
          res.json = (data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
          await mod.default(req, res);
        } catch (error) {
          res.statusCode = error.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(error.message ?? error) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  return {
    envDir: root,
    plugins: [react(), localApi(env)],
    resolve: { alias: { '@shared': path.join(root, 'shared') } },
    server: { fs: { allow: [root] } },
    build: { target: 'es2022', outDir: 'dist' },
  };
});
