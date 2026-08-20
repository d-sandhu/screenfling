export type RelayListener<Value> = (value: Value) => void;

type RelayState<Value> =
  { readonly hasValue: false } | { readonly hasValue: true; readonly value: Value };

export class LatestValueRelay<Value> {
  #listener: RelayListener<Value> | null = null;
  #state: RelayState<Value> = { hasValue: false };

  publish(value: Value): void {
    this.#state = { hasValue: true, value };
    this.#listener?.(value);
  }

  subscribe(listener: RelayListener<Value>): () => void {
    if (this.#listener !== null) throw new Error("A relay listener is already active.");
    this.#listener = listener;
    if (this.#state.hasValue) listener(this.#state.value);

    return () => {
      if (this.#listener === listener) this.#listener = null;
    };
  }
}
