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
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppBoundary>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </AppBoundary>
  </React.StrictMode>,
);
