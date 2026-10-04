import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Providers } from "./providers";
import { ready } from "./lib/wasm";
import "./index.css";

// The key vault is synchronous, but instantiating the WASM core is not. Render
// only once the core is live so no component can observe a half-loaded module.
// A `.then` rather than a top-level `await` keeps the bundle inside the build
// target (top-level await needs es2022+; this app ships es2020).
void ready().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Providers>
        <App />
      </Providers>
    </React.StrictMode>,
  );
});