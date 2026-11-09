import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readConnectors } from '../kicad/kicad.ts';
import type { FileStore } from './fileStore.ts';

export type Assets = { html: string; css: string; js: string };

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
};

const buildServer = (store: FileStore, assets: Assets): Server => {
  const files: Record<string, [string, string]> = {
    '/': [assets.html, 'text/html; charset=utf-8'],
    '/style.css': [assets.css, 'text/css; charset=utf-8'],
    '/app.js': [assets.js, 'text/javascript; charset=utf-8'],
  };
  return createServer(async (request, response) => {
    const send = (status: number, type: string, body: string | Buffer) => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      response.end(body);
    };
    const json = (status: number, value: unknown) => send(status, 'application/json', JSON.stringify(value));
    try {
      if (request.url === '/api/project' && request.method === 'GET') return json(200, await store.load());
      if (request.url === '/api/project' && request.method === 'PUT') {
        const { text, mtimeMs } = JSON.parse(await readBody(request));
        const saved = await store.save(text, mtimeMs);
        return json(saved.ok ? 200 : 409, saved);
      }
      if (request.url === '/api/kicad/connectors' && request.method === 'POST') {
        return json(200, readConnectors(await readBody(request)));
      }
      // DELETE, because a browser preflights it and so other websites cannot stop the app.
      if (request.url === '/api/server' && request.method === 'DELETE') {
        response.once('finish', () => process.exit(0));
        return json(200, { ok: true });
      }
      const file = files[request.url ?? ''];
      if (file && request.method === 'GET') return send(200, file[1], await readFile(file[0]));
      send(404, 'text/plain', 'Not found');
    } catch (error) {
      send(500, 'text/plain', String(error));
    }
  });
};

export const startServer = (store: FileStore, assets: Assets, port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const server = buildServer(store, assets);
    server.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        startServer(store, assets, port + 1).then(resolve, reject);
      } else {
        reject(error);
      }
    });
    server.listen(port, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    });
  });
