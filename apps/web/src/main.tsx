import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { ThemeProvider } from "./components/theme-provider.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { Toaster } from "./components/ui/sonner.js";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("main.tsx: #root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors closeButton position="bottom-right" />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
