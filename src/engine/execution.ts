/** One execution path, driven synchronously or resumed after an async load. */
export type Execution<T> = Generator<Promise<void>, T, void>;

export function runSync<T>(execution: Execution<T>): T {
    const step = execution.next();
    if (step.done) return step.value;
    const error = new Error("This evaluation needs asynchronous loading; use an async evaluation method.");
    execution.throw(error);
    throw error;
}

export async function runAsync<T>(execution: Execution<T>): Promise<T> {
    let step = execution.next();
    while (!step.done) {
        try {
            await step.value;
        } catch (error: unknown) {
            step = execution.throw(error);
            continue;
        }
        step = execution.next();
    }
    return step.value;
}

export function* waitFor<T>(promise: Promise<T>): Execution<T> {
    let result!: T;
    yield promise.then((value) => { result = value; });
    return result;
}

function isExecution<T>(value: T | Execution<T>): value is Execution<T> {
    return typeof value === "object" && value !== null && "next" in value && typeof value.next === "function";
}

export function* resultOf<T>(value: T | Execution<T>): Execution<T> {
    if (isExecution(value)) {
        return yield* value;
    }
    return value;
}
