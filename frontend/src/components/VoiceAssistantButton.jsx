import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FiMic, FiMicOff } from "react-icons/fi";

const COMMAND_EXAMPLES = [
  "open projects",
  "go to projects",
  "go to settings",
  "open settings",
  "create project",
  "new project",
  "open dashboard",
  "open visualizations",
  "open predict",
  "open dashboard section",
  "open visualizations section",
  "open predict section",
  "open settings section",
  "search projects for churn",
  "find project iris",
  "clear project search",
  "go back",
  "go home",
  "open login",
  "open signup",
  "logout",
  "run analysis",
  "analyze dataset",
  "submit form",
  "click create",
  "click run streamlit app",
  "click download py",
  "click download ipynb",
  "click copy url",
  "click continue",
  "scroll down",
  "scroll up",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function VoiceAssistantButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const recognitionRef = useRef(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const [notice, setNotice] = useState("Tap mic and speak a command.");

  const isProjectPath = useMemo(() => /^\/history\/[^/]+$/.test(location.pathname), [location.pathname]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setNotice("Voice recognition not supported in this browser.");
      return;
    }
    setSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript || "";
      setLastHeard(transcript);
      executeCommand(transcript);
      setPanelOpen(false);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setNotice("Could not understand. Try again.");
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // no-op
      }
    };
  }, [location.pathname]);

  const clickByText = (targetText) => {
    const needle = normalizeText(targetText);
    const elements = Array.from(document.querySelectorAll("button, a"));
    const candidate = elements.find((el) => {
      const text = normalizeText(el.textContent);
      const visible = el.offsetParent !== null;
      return visible && text.includes(needle);
    });
    if (candidate) {
      candidate.click();
      return true;
    }
    return false;
  };

  const executeCommand = (spokenText) => {
    const cmd = normalizeText(spokenText);
    if (!cmd) return;

    if (cmd === "open projects" || cmd === "go to projects" || cmd === "go home") {
      navigate("/projects");
      setNotice("Opening Projects.");
      return;
    }
    if (cmd === "go to settings" || cmd === "open settings") {
      navigate("/settings");
      setNotice("Opening Settings.");
      return;
    }
    if (cmd === "create project" || cmd === "new project") {
      navigate("/app");
      setNotice("Opening Create Project.");
      return;
    }
    if (cmd === "open login" || cmd === "open signup") {
      navigate("/auth");
      setNotice("Opening login/signup.");
      return;
    }
    if (cmd === "go back") {
      navigate(-1);
      setNotice("Going back.");
      return;
    }
    if (cmd === "logout") {
      if (!clickByText("logout")) setNotice("Logout button not found.");
      return;
    }

    if (cmd === "open dashboard" || cmd === "open dashboard section") {
      if (isProjectPath) navigate(`${location.pathname}?section=dashboard`);
      else navigate("/projects");
      setNotice("Opening Dashboard.");
      return;
    }
    if (cmd === "open visualizations" || cmd === "open visualizations section") {
      if (isProjectPath) navigate(`${location.pathname}?section=visualizations`);
      else navigate("/projects");
      setNotice("Opening Visualizations.");
      return;
    }
    if (cmd === "open predict" || cmd === "open predict section") {
      if (isProjectPath) navigate(`${location.pathname}?section=predict`);
      else navigate("/projects");
      setNotice("Opening Predict.");
      return;
    }
    if (cmd === "open settings section") {
      if (isProjectPath) navigate(`${location.pathname}?section=settings`);
      else navigate("/settings");
      setNotice("Opening Settings section.");
      return;
    }

    if (cmd.startsWith("search projects for ")) {
      const query = spokenText.slice(spokenText.toLowerCase().indexOf("search projects for ") + 20).trim();
      navigate("/projects");
      window.dispatchEvent(new CustomEvent("voice-search-projects", { detail: { query } }));
      setNotice(`Searching projects for "${query}".`);
      return;
    }
    if (cmd.startsWith("find project ")) {
      const query = spokenText.slice(spokenText.toLowerCase().indexOf("find project ") + 13).trim();
      navigate("/projects");
      window.dispatchEvent(new CustomEvent("voice-search-projects", { detail: { query } }));
      setNotice(`Searching projects for "${query}".`);
      return;
    }
    if (cmd === "clear project search") {
      navigate("/projects");
      window.dispatchEvent(new CustomEvent("voice-search-projects", { detail: { query: "" } }));
      setNotice("Cleared project search.");
      return;
    }

    if (cmd === "run analysis" || cmd === "analyze dataset") {
      if (!clickByText("analyze dataset")) setNotice("Analyze button not found.");
      return;
    }
    if (cmd === "submit form") {
      const submitButton = Array.from(document.querySelectorAll("button[type='submit']")).find(
        (btn) => btn.offsetParent !== null
      );
      if (submitButton) submitButton.click();
      else setNotice("Submit button not found.");
      return;
    }

    if (cmd === "scroll down") {
      const main = document.querySelector("main");
      if (main) main.scrollBy({ top: 260, behavior: "smooth" });
      return;
    }
    if (cmd === "scroll up") {
      const main = document.querySelector("main");
      if (main) main.scrollBy({ top: -260, behavior: "smooth" });
      return;
    }

    if (cmd.startsWith("click ")) {
      const buttonText = cmd.replace(/^click\s+/, "");
      if (!clickByText(buttonText)) setNotice(`Could not find "${buttonText}" to click.`);
      return;
    }

    setNotice("Command not recognized. Try one from the list.");
  };

  const onMicClick = () => {
    if (!supported || !recognitionRef.current) return;
    setPanelOpen(true);
    try {
      if (isListening) {
        recognitionRef.current.stop();
        setIsListening(false);
      } else {
        setNotice("Listening...");
        recognitionRef.current.start();
        setIsListening(true);
      }
    } catch {
      setNotice("Voice input is busy. Try again.");
    }
  };

  return (
    <>
      {panelOpen && (
        <div
          onClick={() => {
            setPanelOpen(false);
            if (isListening && recognitionRef.current) {
              try {
                recognitionRef.current.stop();
              } catch {
                // no-op
              }
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 39,
            background: "radial-gradient(circle at 85% 90%, rgba(var(--cloud-rgb),0.62), rgba(var(--cloud-rgb),0.48) 35%, rgba(var(--cloud-rgb),0.34) 62%, rgba(var(--cloud-rgb),0.24) 100%)",
            backdropFilter: "blur(2px)",
          }}
        />
      )}
      <div style={{ position: "fixed", right: "16px", bottom: "16px", zIndex: 40 }}>
      {panelOpen && (
        <div style={{ marginBottom: "8px", width: "320px", maxWidth: "calc(100vw - 32px)", border: "1px solid #e5e7eb", borderRadius: "12px", background: "#ffffff", boxShadow: "0 10px 30px rgba(15,23,42,0.1)", padding: "10px 12px" }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600, color: "#111827", fontSize: "0.92rem" }}>Voice Commands</p>
          <p style={{ margin: "0 0 6px", color: "#6b7280", fontSize: "0.82rem" }}>{notice}</p>
          {lastHeard && <p style={{ margin: "0 0 6px", color: "#111827", fontSize: "0.82rem" }}>Heard: "{lastHeard}"</p>}
          <div style={{ maxHeight: "120px", overflow: "auto", display: "grid", gap: "4px" }}>
            {COMMAND_EXAMPLES.map((item) => (
              <span key={item} style={{ fontSize: "0.78rem", color: "#4b5563" }}>
                • {item}
              </span>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onMicClick}
        title="Voice assistant"
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "999px",
          border: "none",
          background: isListening ? "#111827" : "#ffffff",
          color: isListening ? "#ffffff" : "#111827",
          boxShadow: "0 8px 20px rgba(15,23,42,0.14)",
          cursor: supported ? "pointer" : "not-allowed",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isListening ? <FiMicOff size={18} /> : <FiMic size={18} />}
      </button>
    </div>
    </>
  );
}

export default VoiceAssistantButton;
