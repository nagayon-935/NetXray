import { useEffect } from "react";
import { TopologyCanvas } from "./components/TopologyCanvas";
import { useWasmEngine } from "./hooks/useWasmEngine";
import { useShareLink } from "./hooks/useShareLink";
import "./index.css";

function App() {
  // Init WASM once at app root — keeps it out of TopologyCanvas's hook chain
  useWasmEngine();

  const { loadFromHash } = useShareLink();

  useEffect(() => {
    loadFromHash();
    // Also listen for hash changes if user navigates history
    window.addEventListener("hashchange", loadFromHash);
    return () => window.removeEventListener("hashchange", loadFromHash);
  }, [loadFromHash]);

  return (
    <div className="w-full h-full">
      <TopologyCanvas />
    </div>
  );
}

export default App;
