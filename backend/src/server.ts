import { buildApp } from './app.js';
import { config } from './config.js';
import { startJobCollection } from './jobs/scheduler.js';

const app = buildApp();
let stopCollection = () => {};
app.addHook('onClose', async () => stopCollection());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
  stopCollection = startJobCollection(app.log);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
