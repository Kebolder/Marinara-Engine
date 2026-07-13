type ImageGenerationQueueTask<T> = () => Promise<T>;

const imageGenerationQueueTails = new Map<string, Promise<void>>();

function imageGenerationAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Image generation request aborted");
}

async function waitForImageGenerationTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  const settledPrevious = previous.catch(() => undefined);
  if (!signal) {
    await settledPrevious;
    return;
  }
  if (signal.aborted) throw imageGenerationAbortError(signal);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(imageGenerationAbortError(signal)));

    signal.addEventListener("abort", onAbort, { once: true });
    void settledPrevious.then(() => finish(resolve));
  });
}

/**
 * Serialize image provider requests per configured connection when the caller's
 * global queue preference is enabled. Callers that disable the preference
 * bypass the queue entirely, while queued callers retain FIFO ordering.
 */
export async function runImageGenerationRequest<T>(args: {
  connectionKey: string;
  queue: boolean;
  task: ImageGenerationQueueTask<T>;
  signal?: AbortSignal;
}): Promise<T> {
  if (!args.queue) {
    if (args.signal?.aborted) throw imageGenerationAbortError(args.signal);
    return args.task();
  }

  const connectionKey = args.connectionKey.trim() || "default";
  const previous = imageGenerationQueueTails.get(connectionKey) ?? Promise.resolve();
  let releaseCurrent: () => void = () => undefined;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  const queuedTail = previous.catch(() => undefined).then(() => current);
  imageGenerationQueueTails.set(connectionKey, queuedTail);

  try {
    await waitForImageGenerationTurn(previous, args.signal);
    if (args.signal?.aborted) throw imageGenerationAbortError(args.signal);
    return await args.task();
  } finally {
    releaseCurrent();
    void queuedTail.finally(() => {
      if (imageGenerationQueueTails.get(connectionKey) === queuedTail) {
        imageGenerationQueueTails.delete(connectionKey);
      }
    });
  }
}
