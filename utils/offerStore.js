// Drop-in Map replacement for ride/carpool dispatch offer bookkeeping.
//
// Previously this was `new Map()` — entirely in-memory, so every server
// restart silently lost every in-flight offer (a ride mid-dispatch would
// have no record of who it was offered to, and a rejected-by-all check
// could never complete). This keeps the exact same synchronous
// get/set/has/delete interface every call site already uses, backed by a
// real in-memory Map for instant reads, but write-through mirrors every
// mutation to Redis (fire-and-forget) so state survives a restart via
// `hydrate()`.
//
// If REDIS_URL isn't set, this silently behaves as a plain in-memory Map —
// nothing breaks, nothing is required to run this locally. It only starts
// actually persisting once a real Redis URL is configured.

const Redis = require("ioredis");

const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  : null;

let redisReady = false;
if (redisClient) {
  redisClient
    .connect()
    .then(() => {
      redisReady = true;
      console.log("✅ Redis connected — offer state will survive restarts");
    })
    .catch((err) => {
      console.warn(
        `⚠️ Redis connection failed (${err.message}) — falling back to in-memory offer state, will not survive a restart`,
      );
    });
}

const createOfferStore = (namespace) => {
  const cache = new Map();
  const redisKey = (key) => `dispatch:${namespace}:${key}`;

  const store = {
    get(key) {
      return cache.get(key);
    },

    has(key) {
      return cache.has(key);
    },

    set(key, value) {
      cache.set(key, value);
      if (redisReady) {
        redisClient
          .set(redisKey(key), JSON.stringify(value), "EX", 60 * 60) // 1h TTL — an offer this old is meaningless anyway
          .catch((err) => console.error(`Offer store Redis write failed (${namespace}):`, err.message));
      }
      return store;
    },

    delete(key) {
      cache.delete(key);
      if (redisReady) {
        redisClient
          .del(redisKey(key))
          .catch((err) => console.error(`Offer store Redis delete failed (${namespace}):`, err.message));
      }
    },

    // Called once at startup to recover state from a previous process —
    // without this, Redis would only ever help future writes, not repair
    // the in-memory cache that was just wiped by the restart itself.
    async hydrate() {
      if (!redisReady) return;
      try {
        const keys = await redisClient.keys(`dispatch:${namespace}:*`);
        if (keys.length === 0) return;
        const values = await redisClient.mget(keys);
        keys.forEach((k, i) => {
          if (!values[i]) return;
          const originalKey = k.replace(`dispatch:${namespace}:`, "");
          try {
            cache.set(originalKey, JSON.parse(values[i]));
          } catch {
            // corrupt/unexpected value — skip it rather than crash startup
          }
        });
        console.log(`♻️  Hydrated ${cache.size} ${namespace} offer(s) from Redis`);
      } catch (err) {
        console.error(`Offer store hydrate failed (${namespace}):`, err.message);
      }
    },
  };

  return store;
};

module.exports = { createOfferStore };
