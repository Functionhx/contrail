import React from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "./ui/foundation/LocaleProvider.jsx";
import { CurrencyProvider } from "./ui/foundation/CurrencyProvider.jsx";
import { TokenFormatProvider } from "./ui/foundation/TokenFormatProvider.jsx";
import App from "./App.jsx";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/geist-mono/700.css";
import "@fontsource/geist-mono/900.css";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <LocaleProvider>
      <TokenFormatProvider>
        <CurrencyProvider>
          <App />
        </CurrencyProvider>
      </TokenFormatProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
