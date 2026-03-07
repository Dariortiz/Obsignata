import { useState, useEffect } from "react";
import { StampView } from "./components/StampView";
import { VerifyView } from "./components/VerifyView";
import { RetrieveView } from "./components/RetrieveView";
import { AppView } from "./lib/types";
import "./index.css";

function getInitialTheme(): "light" | "dark" {
  const stored = localStorage.getItem("obsignata-theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [view, setView] = useState<AppView>("stamp");
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("obsignata-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  const heroes: Record<AppView, { eyebrow: string; heading: JSX.Element; body: string }> = {
    stamp: {
      eyebrow: "Blockchain timestamping",
      heading: <h1>Prove your document existed<br /><em>at this moment.</em></h1>,
      body: "Hash your file locally, commit it to the Polygon blockchain, and receive a cryptographic certificate — without ever uploading your file to a server.",
    },
    retrieve: {
      eyebrow: "Retrieve certificate",
      heading: <h1>Download your certificate<br /><em>anytime.</em></h1>,
      body: "Have your submission ID? Paste it here to check your batch status and download your certificate once it has been committed to the blockchain.",
    },
    verify: {
      eyebrow: "Certificate verification",
      heading: <h1>Verify with<br /><em>or without trusting us.</em></h1>,
      body: "Upload your original document and its certificate. The proof is checked directly against the blockchain — no backend involved. If you prefer, verify it yourself with nothing but the contract address.",
    },
  };

  const { eyebrow, heading, body } = heroes[view];

  return (
    <div className="app">
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <div className="logo">
              <span className="logo-text">Obsignata</span>
              <span className="logo-badge">Polygon</span>
            </div>
            <nav className="nav">
              <button
                className={`nav-btn${view === "stamp" ? " active" : ""}`}
                onClick={() => setView("stamp")}
              >
                Timestamp
              </button>
              <button
                className={`nav-btn${view === "retrieve" ? " active" : ""}`}
                onClick={() => setView("retrieve")}
              >
                Retrieve
              </button>
              <button
                className={`nav-btn${view === "verify" ? " active" : ""}`}
                onClick={() => setView("verify")}
              >
                Verify
              </button>
              <button
                className="nav-btn theme-toggle"
                onClick={toggleTheme}
                title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
                aria-label="Toggle theme"
              >
                {theme === "light" ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="5"/>
                    <line x1="12" y1="1" x2="12" y2="3"/>
                    <line x1="12" y1="21" x2="12" y2="23"/>
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                    <line x1="1" y1="12" x2="3" y2="12"/>
                    <line x1="21" y1="12" x2="23" y2="12"/>
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
                  </svg>
                )}
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="main">
        <div className="container">
          <div className="hero">
            <div className="hero-eyebrow">{eyebrow}</div>
            {heading}
            <p>{body}</p>
          </div>

          {view === "stamp" && <StampView />}
          {view === "retrieve" && <RetrieveView />}
          {view === "verify" && <VerifyView />}
        </div>
      </main>

      <footer className="footer">
        <div className="container">
          <div className="footer-inner">
            <span className="footer-text">
              Obsignata by Darío · Trustless document timestamping on Polygon
            </span>
            <div className="footer-links">
              <a
                className="footer-link"
                href="https://github.com/yourusername/obsignata"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                className="footer-link"
                href="https://polygonscan.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Polygonscan
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}