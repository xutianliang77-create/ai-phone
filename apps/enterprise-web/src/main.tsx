import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/material-icons";
import "@fontsource/material-icons-outlined";
import { EnterpriseApp } from "./App.js";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/auth.css";
import "./styles/app.css";
import "./styles/knowledge.css";

const root = document.getElementById("root");
if (!root) throw new Error("Enterprise Web root element is missing");

createRoot(root).render(
  <StrictMode>
    <EnterpriseApp />
  </StrictMode>,
);
