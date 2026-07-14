import { createElement, useLayoutEffect, useRef } from "react";

type CapabilityElementNode = HTMLElement & {
  capabilityProps?: Record<string, unknown>;
};

interface CapabilityElementProps {
  packageId: string;
  view: "surface" | "setup" | "settings" | "toolbar" | "workspace" | "runtime" | "world-map";
  capabilityProps?: Record<string, unknown>;
  className?: string;
}

function capabilityTag(packageId: string) {
  return `marinara-capability-${packageId}`;
}

export function CapabilityElement({ packageId, view, capabilityProps, className }: CapabilityElementProps) {
  const ref = useRef<CapabilityElementNode | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.capabilityProps = capabilityProps;
    ref.current.dispatchEvent(new CustomEvent("marinara-capability-props"));
  }, [capabilityProps]);

  return createElement(capabilityTag(packageId), {
    ref,
    view,
    class: className,
  });
}
