class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.maxFailures = options.maxFailures || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.halfOpenMaxRequests = options.halfOpenMaxRequests || 1;

    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureAt = null;
    this.nextAttemptAt = null;
    this.lastError = null;
  }

  get isOpen() {
    return this.state === 'OPEN';
  }

  get isHalfOpen() {
    return this.state === 'HALF_OPEN';
  }

  get isClosed() {
    return this.state === 'CLOSED';
  }

  allowRequest() {
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (this.nextAttemptAt && Date.now() >= this.nextAttemptAt) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      return this.successCount < this.halfOpenMaxRequests;
    }

    return false;
  }

  onSuccess() {
    this.failureCount = 0;
    this.successCount++;
    this.lastError = null;

    if (this.state === 'HALF_OPEN' && this.successCount >= this.halfOpenMaxRequests) {
      this.state = 'CLOSED';
      this.nextAttemptAt = null;
    }
  }

  onFailure(error) {
    this.failureCount++;
    this.lastFailureAt = new Date();
    this.lastError = error?.message || String(error);

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
      this.successCount = 0;
      return;
    }

    if (this.failureCount >= this.maxFailures) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
    }
  }

  async call(fn, fallback = null) {
    if (!this.allowRequest()) {
      const err = new Error(`Circuit breaker [${this.name}] is OPEN — request rejected`);
      err.code = 'CIRCUIT_OPEN';
      err.cbState = this.state;
      err.cbName = this.name;
      if (fallback) return fallback(err);
      throw err;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      const isTransient = this._isTransientError(err);
      if (isTransient) {
        this.onFailure(err);
      }
      if (fallback) return fallback(err);
      throw err;
    }
  }

  _isTransientError(err) {
    const msg = err?.message?.toLowerCase() || '';
    const status = err?.status || err?.response?.status;
    return (
      status === 429 ||
      status >= 500 ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('socket') ||
      msg.includes('too many requests')
    );
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      nextAttemptAt: this.nextAttemptAt ? new Date(this.nextAttemptAt) : null,
      lastError: this.lastError,
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureAt = null;
    this.nextAttemptAt = null;
    this.lastError = null;
  }
}

const breakers = new Map();

function getBreaker(name, options) {
  if (!breakers.has(name)) {
    breakers.set(name, new CircuitBreaker(name, options));
  }
  return breakers.get(name);
}

function allBreakerStatuses() {
  return Array.from(breakers.values()).map((b) => b.status());
}

module.exports = { CircuitBreaker, getBreaker, allBreakerStatuses };
