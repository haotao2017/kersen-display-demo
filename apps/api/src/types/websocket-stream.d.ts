declare module 'websocket-stream' {
  import { Server } from 'node:http';
  import { Duplex } from 'node:stream';

  export interface CreateServerOptions {
    server: Server;
    path?: string;
  }

  export function createServer(options: CreateServerOptions, onConnection: (stream: Duplex) => void): void;
}
