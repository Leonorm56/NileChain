# @pwabucket/pwa-router

Hooks and utilities for client-side routing in React applications, designed for Progressive Web Apps (PWAs). Built on top of [React Router](https://reactrouter.com/).

## Installation

```bash
# npm
npm install @pwabucket/pwa-router

# pnpm
pnpm add @pwabucket/pwa-router
```

### Peer Dependencies

- `react` ^18 || ^19
- `react-router` ^7

## Setup

Wrap your application with `PWARoutingProvider` inside a React Router context. The provider manages internal history tracking needed by the routing hooks.

```tsx
// main.tsx
import App from "./App.tsx";
import { BrowserRouter } from "react-router";
import { PWARoutingProvider } from "@pwabucket/pwa-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <PWARoutingProvider>
        <App />
      </PWARoutingProvider>
    </BrowserRouter>
  </StrictMode>,
);

// App.tsx
import { usePWARouting } from "@pwabucket/pwa-router";
import { Routes, Route } from "react-router";

function App() {
  const { resolvedLocation } = usePWARouting();
  
  return (
    <Routes location={resolvedLocation}>
        {/* your routes */}
    </Routes>
  );
}
```

## Hooks

### `usePWARouting`

Access the `PWARoutingContext` value, which exposes the resolved location.

```tsx
import { usePWARouting } from "@pwabucket/pwa-router";

const { resolvedLocation } = usePWARouting();
```

**Returns:** `PWARoutingContextValue` — `{ resolvedLocation: Location }`

---

### `useLocationState`

Manage state tied to the current location entry. When the value is cleared (`undefined`), it navigates back automatically.

```tsx
import { useLocationState } from "@pwabucket/pwa-router";

const [value, setValue] = useLocationState("myKey", "default");

// Set a new value (pushes to history)
setValue("new value");

// Clear value (navigates back)
setValue(undefined);

// Clear value and navigate back to a specific history index
setValue(undefined, {}, historyIndex);
```

**Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `key` | `string` | State key in `location.state` |
| `defaultValue` | `T` | Fallback when the key is not present |

**Returns:** `[T, (value?: T, options?: NavigateOptions, index?: number) => void]`

- When `value` is provided, navigates to the current location with the new state value.
- When `value` is `undefined` and `index` is provided, calculates a history delta and navigates back to that entry.
- When `value` is `undefined` and no `index`, navigates back one entry (or to `"/"` if there is no prior history).

---

### `useLocationToggle`

A convenience wrapper around `useLocationState` for boolean toggle patterns (e.g. modals, drawers, sheets). Internally uses `useLocationIndex` to navigate back to the correct history entry when closing.

```tsx
import { useLocationToggle } from "@pwabucket/pwa-router";

const [isOpen, toggle] = useLocationToggle("modal");

// Open
toggle(true);

// Close (navigates back)
toggle(false);
```

**Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `key` | `string` | State key in `location.state` |
| `indexKey` | `string?` | Optional key for index tracking (see `useLocationIndex`) |

**Returns:** `[boolean, (status: boolean, options?: NavigateOptions) => void]`

---

### `useLocationIndex`

Reads the saved history index for a given key from `location.state`. The index is stored under the key `__router_index_<key>`. Used internally by `useLocationToggle` to navigate back to the correct entry.

```tsx
import { useLocationIndex } from "@pwabucket/pwa-router";

const index = useLocationIndex("modal");
```

**Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `key` | `string?` | The index tracking key |

**Returns:** `number | undefined`

---

### `useLocationIndexUpdater`

Stamps the current `history.length` onto `location.state` (under `__router_index_<key>`) so that `useLocationToggle` can navigate back to the correct entry when closing. Call this in a layout or page component that serves as a "base" for toggled UI.

```tsx
import { useLocationIndexUpdater } from "@pwabucket/pwa-router";

function Layout() {
  useLocationIndexUpdater("modal");
  // ...
}
```

**Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `key` | `string` | The index tracking key |

---

### `useNavigateBack`

Returns a callback that navigates back in history. If there is no prior history entry (i.e. the user landed directly on the page), it navigates to a root path instead.

```tsx
import { useNavigateBack } from "@pwabucket/pwa-router";

function Header() {
  const navigateBack = useNavigateBack();

  return <button onClick={() => navigateBack()}>Back</button>;
}
```

**Parameters:**

| Param | Type | Description |
| --- | --- | --- |
| `root` | `string?` | Fallback path when there is no history to go back to (default: `"/"`) |

**Returns:** `(options?: NavigateOptions) => void`

## Types

The following types are exported for convenience:

- **`PWARoutingContextValue`** — `{ resolvedLocation: Location }`
- **`UseLocationStateReturn<T>`** — `[T, (value?: T, options?: NavigateOptions, index?: number) => void]`
- **`UseLocationToggleReturn`** — `[boolean, (status: boolean, options?: NavigateOptions) => void]`

## License

[MIT](LICENSE)