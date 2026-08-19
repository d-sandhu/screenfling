import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App() {
  return (
    <main className="shell">
      <p className="eyebrow">Pre-alpha foundation</p>
      <h1>ScreenFling</h1>
      <p className="summary">
        Capture visual context. Route it to the right coding session. Keep working.
      </p>
      <dl className="status">
        <div>
          <dt>Current phase</dt>
          <dd>Scaffold and feasibility gates</dd>
        </div>
        <div>
          <dt>Automatic Send</dt>
          <dd>Disabled by design</dd>
        </div>
      </dl>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("ScreenFling renderer root is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
