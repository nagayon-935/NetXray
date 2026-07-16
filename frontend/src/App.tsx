import { TopologyCanvas } from "./components/TopologyCanvas";
import { Toaster } from "./components/Toaster";
import { useWasmEngine } from "./hooks/useWasmEngine";
import "./index.css";

function App() {
  useWasmEngine();

  return (
    <div className="w-full h-full">
      <TopologyCanvas />
      <Toaster />
    </div>
  );
}

export default App;
