function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { maxRetries = 3, baseDelay = 1000, shouldRetry } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      const retryAllowed = typeof shouldRetry === "function" ? shouldRetry(error) : true;
      if (!retryAllowed || attempt === maxRetries) {
        throw error;
      }
      const jitter = Math.floor(Math.random() * 500);
      const delay = baseDelay * 2 ** attempt + jitter;
      await sleep(delay);
    }
  }
  return null;
}

module.exports = { withRetry };
