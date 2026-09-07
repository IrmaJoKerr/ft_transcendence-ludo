import { SocketServer } from './socket/server';

const PORT = parseInt(process.env.PORT || '3001');

// Engine process entry point: start the socket server on PORT (3001) and
// shut down cleanly on SIGINT. Run via `node dist/index.js` in the container.
async function main() {
  const server = new SocketServer();
  await server.start(PORT);

  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await server.stop();
    process.exit(0);
  });
}

main().catch(console.error);