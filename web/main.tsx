import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { reportClientError } from "./api";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

window.addEventListener("error", (e) => reportClientError("error", e.message || "error", { stack: e.error?.stack, where: `${e.filename}:${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => reportClientError("rejection", String((e.reason as Error)?.message ?? e.reason), { stack: (e.reason as Error)?.stack }));

// Service worker (app shell only) needs a secure context: HTTPS via tailscale serve.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
