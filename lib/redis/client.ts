import IORedis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'cobranzas-redis';
const redisPort = parseInt(process.env.REDIS_PORT || '6379');

let redisClient: IORedis | null = null;

export function getRedis(): IORedis {
  if (!redisClient) {
    redisClient = new IORedis(redisPort, redisHost, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      console.error('[Redis] Error de conexión:', err.message);
    });
  }
  return redisClient;
}
