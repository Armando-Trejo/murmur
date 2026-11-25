import React from "react";
import { MotionConfig } from "framer-motion";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AppBoundary } from "./components/AppBoundary";
import "./styles.css";
import "./mobile-qa.css";
import "./experience.css";
import "./premium.css";
import "./v27.css";
import "./v28.css";
/** Last 10 interface errors, kept on the phone and attached only to a report the person chooses to send. */
function rememberError(message: string) {
  try {
    const list = (localStorage.getItem("murmur.jsErrors") || "").split("\n").filter(Boolean);
    list.unshift(new Date().toISOString().slice(0, 19) + " " + message.slice(0, 300).replace(/\n/g, " "));
    localStorage.setItem("murmur.jsErrors", list.slice(0, 10).join("\n"));
  } catch { /* Storage unavailable: nothing to keep. */ }
}
window.addEventListener("error", (e) => rememberError(e.message || "Error"));
window.addEventListener("unhandledrejection", (e) => rememberError(String((e.reason as Error)?.message || e.reason)));
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </AppBoundary>
  </React.StrictMode>,
);
