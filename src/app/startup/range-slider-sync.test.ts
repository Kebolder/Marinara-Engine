// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { installRangeSliderSync } from "./range-slider-sync";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function createRangeInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.value = value;
  document.body.appendChild(input);
  return input;
}

describe("installRangeSliderSync", () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it("re-syncs --range-progress when a range input value is assigned programmatically without an event", () => {
    // Append before install so syncAll() seeds a clean "0%" baseline (the pre-fix RED value).
    const input = createRangeInput("0");

    dispose = installRangeSliderSync();
    expect(input.style.getPropertyValue("--range-progress")).toBe("0%");

    // React updates a controlled slider this way: assign .value directly, no input/change event.
    input.value = "75";

    // GREEN (post-fix): the patched value setter re-runs syncRangeSliderProgress.
    // RED (pre-fix): the native setter never touches style, so this stays "0%".
    expect(input.style.getPropertyValue("--range-progress")).toBe("75%");
  });

  it("stops auto-syncing programmatic value assignments after dispose restores the native setter", () => {
    const first = createRangeInput("0");
    dispose = installRangeSliderSync();

    // Sanity: while installed, programmatic assignment syncs.
    first.value = "50";
    expect(first.style.getPropertyValue("--range-progress")).toBe("50%");

    dispose();
    dispose = undefined;

    // A fresh range input created after dispose: the prototype value setter is the
    // native one again, and the MutationObserver is disconnected, so assigning .value
    // must NOT set --range-progress.
    const afterDispose = createRangeInput("0");
    afterDispose.value = "75";
    expect(afterDispose.style.getPropertyValue("--range-progress")).toBe("");
  });

  it("does not leak a permanently-patched prototype across overlapping installs", () => {
    // Overlapping install/dispose (HMR / StrictMode / concurrent remount): install
    // twice before disposing either, then dispose both. The native setter must be
    // fully restored, not left wrapped.
    const dispose1 = installRangeSliderSync();
    const dispose2 = installRangeSliderSync();
    dispose1();
    dispose2();

    const afterBoth = createRangeInput("0");
    afterBoth.value = "70";
    expect(afterBoth.style.getPropertyValue("--range-progress")).toBe("");
  });

  it("does not clobber a third-party value-setter patch installed after slider-sync", () => {
    dispose = installRangeSliderSync();

    // A later subsystem wraps the value setter (e.g. a validation/analytics shim).
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
    const wrappedSetter = descriptor.set!;
    let thirdPartyCalls = 0;
    Object.defineProperty(window.HTMLInputElement.prototype, "value", {
      ...descriptor,
      set(this: HTMLInputElement, next: string) {
        thirdPartyCalls += 1;
        wrappedSetter.call(this, next);
      },
    });

    // slider-sync disposes; it must NOT write back the native descriptor over the
    // third-party patch, since its own setter is no longer the active one.
    dispose!();
    dispose = undefined;

    const input = createRangeInput("0");
    input.value = "40";
    expect(thirdPartyCalls).toBeGreaterThan(0);

    // Clean up the third-party patch so other tests see a pristine prototype.
    Object.defineProperty(window.HTMLInputElement.prototype, "value", descriptor);
  });
});
