import { TopologyCanvas } from "./components/TopologyCanvas";
import { useWasmEngine } from "./hooks/useWasmEngine";
import "./index.css";

function App() {
  // Init WASM once at app root — keeps it out of TopologyCanvas's hook chain
  useWasmEngine();

  return (
    <div className="w-full h-full">
      <TopologyCanvas />
    </div>
  );
}

export default App;
