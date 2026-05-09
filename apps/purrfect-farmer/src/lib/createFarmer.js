import { createElement, lazy, Suspense } from "react";

// Wrap lazy imports with Suspense to handle loading state gracefully
const TerminalFarmer = lazy(() =>
  import("@/partials/TerminalFarmer").catch((err) => {
    console.error("Failed to load TerminalFarmer:", err);
    // Return a fallback component if import fails
    return import("@/components/ErrorFallback");
  }),
);

/**
 * Get all static properties from a class and its parent classes
 */
function getAllStaticProperties(Class) {
  const properties = {};
  let currentClass = Class;

  /* Walk up the prototype chain */
  while (currentClass && currentClass !== Function.prototype) {
    /* Get all static property names */
    const propertyNames = Object.getOwnPropertyNames(currentClass);

    /* Copy static properties except built-in ones */
    for (const key of propertyNames) {
      if (
        !["prototype", "length", "name", "constructor"].includes(key) &&
        !(key in properties)
      ) {
        properties[key] = currentClass[key];
      }
    }

    /* Move to parent class */
    currentClass = Object.getPrototypeOf(currentClass);
  }

  return properties;
}

export function createFarmer(FarmerClass, options) {
  return {
    ...getAllStaticProperties(FarmerClass),
    FarmerClass,
    tabType: "farmer",
    component: createElement(Suspense, { fallback: null }, createElement(TerminalFarmer)),
    netRequest: {
      ...(FarmerClass.netRequest || {}),
      ...(FarmerClass.host
        ? {
            origin: `https://${FarmerClass.host}`,
            domains: FarmerClass.domains,
          }
        : {}),
    },
    ...options,
  };
}
